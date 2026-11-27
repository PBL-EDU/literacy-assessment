/* eslint-disable */
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import { decryptSecret } from "../security/secrets.js";
import { withTransaction, type Db } from "../db/index.js";
import {
  randomToken,
  sha256,
  signAccessToken,
  verifyAccessToken,
  verifyPassword,
  verifyTotp,
  type AccessPayload,
} from "../security/tokens.js";

export interface OrgInfo {
  id: string;
  name: string;
  slug: string;
}

export interface MemberInfo {
  id: string;
  displayName: string;
  role: "teacher" | "mentor";
}

export interface AuthContext {
  org: OrgInfo;
  member: MemberInfo;
  deviceId: string;
}

export interface TokenBundle {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  org: OrgInfo;
  member: MemberInfo;
}

function accessTokenFor(member: MemberInfo, orgId: string, deviceId: string, config: AppConfig): string {
  return signAccessToken(
    {
      sub: member.id,
      dev: deviceId,
      org: orgId,
      role: member.role,
      exp: 0,
    },
    config.authSecret,
  );
}

function memberFromRow(row: Record<string, unknown>): MemberInfo {
  return {
    id: String(row.member_id ?? row.id),
    displayName: String(row.display_name),
    role: row.role === "mentor" ? "mentor" : "teacher",
  };
}

export async function redeemInvite(
  db: Db,
  config: AppConfig,
  input: { code: string; displayName: string; deviceName: string },
): Promise<TokenBundle> {
  const code = input.code.trim().toUpperCase();
  const displayName = input.displayName.trim();
  const deviceName = input.deviceName.trim() || "Obsidian";
  if (!/^[A-Z0-9]{8,24}$/.test(code)) throw new Error("邀请码格式不正确");
  if (displayName.length < 1 || displayName.length > 40) throw new Error("姓名长度不正确");
  if (deviceName.length > 80) throw new Error("设备名过长");

  return withTransaction(db, async (client) => {
    const inviteResult = await client.query(
      `SELECT i.*, o.name AS org_name, o.slug AS org_slug, o.status AS org_status
       FROM invites i
       JOIN organizations o ON o.id = i.org_id
       WHERE i.code_hash = $1
       LIMIT 1
       FOR UPDATE`,
      [sha256(code)],
    );
    const invite = inviteResult.rows[0] as Record<string, unknown> | undefined;
    if (!invite) throw new Error("邀请码无效");
    if (invite.org_status !== "active") throw new Error("组织已停用");
    if (new Date(String(invite.expires_at)).getTime() <= Date.now()) throw new Error("邀请码已过期");
    if (Number(invite.used_count) >= Number(invite.max_uses)) throw new Error("邀请码已用完");

    const memberId = randomUUID();
    const deviceId = randomUUID();
    const refreshToken = randomToken(32);
    const orgId = String(invite.org_id);

    await client.query(
      `INSERT INTO members (id, org_id, display_name, role, status)
       VALUES ($1, $2, $3, 'teacher', 'active')`,
      [memberId, orgId, displayName],
    );
    await client.query(
      `INSERT INTO devices (id, member_id, name, refresh_token_hash, last_seen_at)
       VALUES ($1, $2, $3, $4, now())`,
      [deviceId, memberId, deviceName, sha256(refreshToken)],
    );
    await client.query("UPDATE invites SET used_count = used_count + 1 WHERE id = $1", [invite.id]);

    const member: MemberInfo = { id: memberId, displayName, role: "teacher" };
    const org: OrgInfo = { id: orgId, name: String(invite.org_name), slug: String(invite.org_slug) };
    return {
      accessToken: accessTokenFor(member, orgId, deviceId, config),
      refreshToken,
      expiresIn: 15 * 60,
      org,
      member,
    };
  });
}

export async function refreshSession(
  db: Db,
  config: AppConfig,
  refreshToken: string,
): Promise<TokenBundle> {
  const tokenHash = sha256(refreshToken.trim());
  return withTransaction(db, async (client) => {
    const result = await client.query(
      `SELECT d.id AS device_id, d.revoked_at,
              m.id AS member_id, m.display_name, m.role, m.status AS member_status,
              o.id AS org_id, o.name AS org_name, o.slug AS org_slug, o.status AS org_status
       FROM devices d
       JOIN members m ON m.id = d.member_id
       JOIN organizations o ON o.id = m.org_id
       WHERE d.refresh_token_hash = $1
       LIMIT 1
       FOR UPDATE`,
      [tokenHash],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row || row.revoked_at) throw new Error("设备会话已失效");
    if (row.member_status !== "active") throw new Error("成员已停用");
    if (row.org_status !== "active") throw new Error("组织已停用");

    const nextRefresh = randomToken(32);
    await client.query("UPDATE devices SET refresh_token_hash = $1, last_seen_at = now() WHERE id = $2", [
      sha256(nextRefresh),
      row.device_id,
    ]);
    const member = memberFromRow(row);
    return {
      accessToken: accessTokenFor(member, String(row.org_id), String(row.device_id), config),
      refreshToken: nextRefresh,
      expiresIn: 15 * 60,
      org: { id: String(row.org_id), name: String(row.org_name), slug: String(row.org_slug) },
      member,
    };
  });
}

export async function authenticate(
  db: Db,
  config: AppConfig,
  token: string,
): Promise<AuthContext | null> {
  const payload: AccessPayload | null = verifyAccessToken(token, config.authSecret);
  if (!payload) return null;
  const result = await db.query(
    `SELECT m.id AS member_id, m.display_name, m.role, m.status AS member_status,
            d.id AS device_id, d.revoked_at,
            o.id AS org_id, o.name AS org_name, o.slug AS org_slug, o.status AS org_status
     FROM members m
     JOIN devices d ON d.id = $2 AND d.member_id = m.id
     JOIN organizations o ON o.id = m.org_id
     WHERE m.id = $1`,
    [payload.sub, payload.dev],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row || row.revoked_at || row.member_status !== "active" || row.org_status !== "active") return null;
  return {
    org: { id: String(row.org_id), name: String(row.org_name), slug: String(row.org_slug) },
    member: memberFromRow(row),
    deviceId: String(row.device_id),
  };
}

export async function revokeDevice(db: Db, memberId: string, deviceId: string): Promise<void> {
  await db.query("UPDATE devices SET revoked_at = now() WHERE id = $1 AND member_id = $2", [
    deviceId,
    memberId,
  ]);
}

export interface AdminContext {
  id: string;
  org: OrgInfo;
  username: string;
}

export async function adminLogin(
  db: Db,
  config: AppConfig,
  username: string,
  password: string,
  totp?: string,
): Promise<{ token: string; expiresAt: Date; admin: AdminContext }> {
  const result = await db.query(
    `SELECT a.*, o.name AS org_name, o.slug AS org_slug, o.status AS org_status
     FROM admin_users a JOIN organizations o ON o.id = a.org_id
     WHERE a.username = $1 LIMIT 1`,
    [username.trim()],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row || row.status !== "active" || row.org_status !== "active") {
    throw new Error("用户名或密码不正确");
  }
  if (!(await verifyPassword(password, String(row.password_hash)))) {
    throw new Error("用户名或密码不正确");
  }
  if (row.totp_enabled) {
    if (!row.totp_secret_encrypted || !totp) throw new Error("需要 TOTP 验证码");
    const secret = decryptSecret(String(row.totp_secret_encrypted), config.masterKey);
    if (!verifyTotp(secret, totp)) throw new Error("TOTP 验证码不正确");
  }
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
  await db.query(
    `INSERT INTO admin_sessions (id, admin_user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [randomUUID(), row.id, sha256(token), expiresAt],
  );
  await db.query("UPDATE admin_users SET last_login_at = now() WHERE id = $1", [row.id]);
  return {
    token,
    expiresAt,
    admin: {
      id: String(row.id),
      username: String(row.username),
      org: { id: String(row.org_id), name: String(row.org_name), slug: String(row.org_slug) },
    },
  };
}

export async function authenticateAdmin(
  db: Db,
  sessionToken: string,
): Promise<AdminContext | null> {
  if (!sessionToken) return null;
  const result = await db.query(
    `SELECT a.id, a.username, a.org_id, o.name AS org_name, o.slug AS org_slug
     FROM admin_sessions s
     JOIN admin_users a ON a.id = s.admin_user_id
     JOIN organizations o ON o.id = a.org_id
     WHERE s.token_hash = $1 AND s.expires_at > now()
       AND a.status = 'active' AND o.status = 'active'
     LIMIT 1`,
    [sha256(sessionToken)],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    username: String(row.username),
    org: { id: String(row.org_id), name: String(row.org_name), slug: String(row.org_slug) },
  };
}

export async function adminLogout(db: Db, sessionToken: string): Promise<void> {
  if (!sessionToken) return;
  await db.query("DELETE FROM admin_sessions WHERE token_hash = $1", [sha256(sessionToken)]);
}

export async function createInvite(
  db: Db,
  admin: AdminContext,
  input: { expiresInHours: number; maxUses: number },
): Promise<{ code: string; expiresAt: Date }> {
  const code = randomCode(10);
  const expiresAt = new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000);
  await db.query(
    `INSERT INTO invites (id, org_id, code_hash, expires_at, max_uses, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), admin.org.id, sha256(code), expiresAt, input.maxUses, admin.id],
  );
  return { code, expiresAt };
}

function randomCode(length: number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomToken(32);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += alphabet[Buffer.from(bytes, "base64url")[i] % alphabet.length];
  }
  return result;
}

export async function createMemberAndDeviceForTest(
  db: Db,
  config: AppConfig,
  orgId: string,
  displayName: string,
): Promise<TokenBundle> {
  const memberId = randomUUID();
  const deviceId = randomUUID();
  const refreshToken = randomToken(32);
  await db.query(
    `INSERT INTO members (id, org_id, display_name, role, status)
     VALUES ($1, $2, $3, 'teacher', 'active')`,
    [memberId, orgId, displayName],
  );
  await db.query(
    `INSERT INTO devices (id, member_id, name, refresh_token_hash)
     VALUES ($1, $2, 'test', $3)`,
    [deviceId, memberId, sha256(refreshToken)],
  );
  const orgResult = await db.query("SELECT id, name, slug FROM organizations WHERE id = $1", [orgId]);
  const org = orgResult.rows[0] as { id: string; name: string; slug: string };
  const member: MemberInfo = { id: memberId, displayName, role: "teacher" };
  return {
    accessToken: accessTokenFor(member, orgId, deviceId, config),
    refreshToken,
    expiresIn: 15 * 60,
    org,
    member,
  };
}
