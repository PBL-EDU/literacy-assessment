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
  hashPassword,
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
  teamId?: string;
  teamName?: string;
  isTeamLead?: boolean;
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
    teamId: row.team_id ? String(row.team_id) : undefined,
    teamName: row.team_name ? String(row.team_name) : undefined,
    isTeamLead: Boolean(row.is_team_lead),
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

    const deviceId = randomUUID();
    const refreshToken = randomToken(32);
    const orgId = String(invite.org_id);
    const boundMemberId = invite.member_id ? String(invite.member_id) : "";
    const teacherName = String(invite.teacher_name || displayName).trim() || displayName;
    const teamId = invite.team_id ? String(invite.team_id) : undefined;
    const teamName = invite.team_name ? String(invite.team_name) : undefined;
    let memberId = boundMemberId;
    if (boundMemberId) {
      const existing = await client.query(
        "SELECT id, status FROM members WHERE id = $1 AND org_id = $2 FOR UPDATE",
        [boundMemberId, orgId],
      );
      if (!existing.rows[0] || existing.rows[0].status !== "active") {
        throw new Error("教师记录已停用或不存在");
      }
      await client.query(
        "UPDATE members SET display_name = $1, team_id = $2, team_name = $3, updated_at = now() WHERE id = $4",
        [teacherName, teamId ?? null, teamName ?? null, memberId],
      );
    } else {
      memberId = randomUUID();
      await client.query(
        `INSERT INTO members (id, org_id, display_name, role, status, team_id, team_name)
         VALUES ($1, $2, $3, 'teacher', 'active', $4, $5)`,
        [memberId, orgId, teacherName, teamId ?? null, teamName ?? null],
      );
    }
    await client.query(
      `INSERT INTO devices (id, member_id, name, refresh_token_hash, last_seen_at)
       VALUES ($1, $2, $3, $4, now())`,
      [deviceId, memberId, deviceName, sha256(refreshToken)],
    );
    await client.query("UPDATE invites SET used_count = used_count + 1 WHERE id = $1", [invite.id]);

    let isTeamLead = false;
    if (teamId) {
      const lead = await client.query(
        "SELECT 1 FROM teams WHERE id = $1 AND org_id = $2 AND lead_member_id = $3",
        [teamId, orgId, memberId],
      );
      isTeamLead = Boolean(lead.rows[0]);
    }
    const member: MemberInfo = { id: memberId, displayName: teacherName, role: "teacher", teamId, teamName, isTeamLead };
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
              m.team_id, m.team_name,
              t.status AS team_status,
              EXISTS (SELECT 1 FROM teams t2 WHERE t2.id = m.team_id AND t2.lead_member_id = m.id) AS is_team_lead,
              o.id AS org_id, o.name AS org_name, o.slug AS org_slug, o.status AS org_status
       FROM devices d
       JOIN members m ON m.id = d.member_id
       LEFT JOIN teams t ON t.id = m.team_id
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
            m.team_id, m.team_name,
            t.status AS team_status,
            EXISTS (SELECT 1 FROM teams t2 WHERE t2.id = m.team_id AND t2.lead_member_id = m.id) AS is_team_lead,
            d.id AS device_id, d.revoked_at,
            o.id AS org_id, o.name AS org_name, o.slug AS org_slug, o.status AS org_status
     FROM members m
     JOIN devices d ON d.id = $2 AND d.member_id = m.id
     LEFT JOIN teams t ON t.id = m.team_id
     JOIN organizations o ON o.id = m.org_id
     WHERE m.id = $1`,
    [payload.sub, payload.dev],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row || row.revoked_at || row.member_status !== "active" || row.org_status !== "active") return null;
  if (row.team_id && row.team_status !== "active") return null;
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
  /** Active tenant for this admin session. */
  org: OrgInfo;
  /** The admin's home tenant. */
  homeOrg: OrgInfo;
  username: string;
  isPlatformAdmin: boolean;
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
      homeOrg: { id: String(row.org_id), name: String(row.org_name), slug: String(row.org_slug) },
      isPlatformAdmin: Boolean(row.is_platform_admin),
    },
  };
}

export async function authenticateAdmin(
  db: Db,
  sessionToken: string,
): Promise<AdminContext | null> {
  if (!sessionToken) return null;
  const result = await db.query(
    `SELECT a.id, a.username, a.org_id, a.is_platform_admin,
            o.name AS org_name, o.slug AS org_slug,
            s.active_org_id
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
  const homeOrg: OrgInfo = { id: String(row.org_id), name: String(row.org_name), slug: String(row.org_slug) };
  let org = homeOrg;
  if (row.is_platform_admin && row.active_org_id) {
    const active = await db.query(
      "SELECT id, name, slug FROM organizations WHERE id = $1 AND status = 'active'",
      [row.active_org_id],
    );
    const activeRow = active.rows[0];
    if (activeRow) org = { id: String(activeRow.id), name: String(activeRow.name), slug: String(activeRow.slug) };
  }
  return {
    id: String(row.id),
    username: String(row.username),
    org,
    homeOrg,
    isPlatformAdmin: Boolean(row.is_platform_admin),
  };
}

export async function adminLogout(db: Db, sessionToken: string): Promise<void> {
  if (!sessionToken) return;
  await db.query("DELETE FROM admin_sessions WHERE token_hash = $1", [sha256(sessionToken)]);
}

export async function createInvite(
  db: Db,
  admin: AdminContext,
  input: { expiresInHours: number; maxUses: number; teacherId?: string; teacherName?: string; teamId?: string },
): Promise<{ code: string; expiresAt: Date; teacherName: string; teamName: string }> {
  let teacherName = (input.teacherName ?? "").trim();
  let teamName = "";
  let teamId = input.teamId || undefined;
  if (input.teacherId) {
    const member = await db.query(
      "SELECT id, display_name, team_id, team_name FROM members WHERE id = $1 AND org_id = $2 AND status = 'active'",
      [input.teacherId, admin.org.id],
    );
    const row = member.rows[0];
    if (!row) throw new Error("教师记录不存在或已停用");
    teacherName = String(row.display_name);
    teamId = row.team_id ? String(row.team_id) : teamId;
    teamName = row.team_name ? String(row.team_name) : "";
  }
  if (!teacherName) throw new Error("请先选择教师或填写教师姓名");
  if (!teamId) throw new Error("请选择教师所属团队");
  const team = await db.query(
    "SELECT id, name FROM teams WHERE id = $1 AND org_id = $2 AND status = 'active'",
    [teamId, admin.org.id],
  );
  if (!team.rows[0]) throw new Error("团队不存在或已停用");
  teamName = String(team.rows[0].name);
  const code = randomCode(10);
  const expiresAt = new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000);
  await db.query(
    `INSERT INTO invites (id, org_id, code_hash, expires_at, max_uses, created_by, teacher_name, team_id, team_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [randomUUID(), admin.org.id, sha256(code), expiresAt, input.maxUses, admin.id, teacherName, teamId, teamName],
  );
  return { code, expiresAt, teacherName, teamName };
}

export async function createTeam(
  db: Db,
  admin: AdminContext,
  name: string,
): Promise<{ id: string; name: string }> {
  const clean = name.trim();
  if (!clean || clean.length > 80) throw new Error("团队名称不合法");
  const id = randomUUID();
  await db.query(
    "INSERT INTO teams (id, org_id, name, status) VALUES ($1, $2, $3, 'active')",
    [id, admin.org.id, clean],
  );
  return { id, name: clean };
}

export async function assignTeamLead(
  db: Db,
  admin: AdminContext,
  teamId: string,
  memberId: string | null,
): Promise<void> {
  const team = await db.query(
    "SELECT id FROM teams WHERE id = $1 AND org_id = $2 AND status = 'active'",
    [teamId, admin.org.id],
  );
  if (!team.rows[0]) throw new Error("团队不存在或已停用");
  if (memberId) {
    const member = await db.query(
      "SELECT id FROM members WHERE id = $1 AND org_id = $2 AND team_id = $3 AND status = 'active'",
      [memberId, admin.org.id, teamId],
    );
    if (!member.rows[0]) throw new Error("导师不在该团队或已停用");
  }
  await db.query("UPDATE teams SET lead_member_id = $1, updated_at = now() WHERE id = $2 AND org_id = $3", [
    memberId,
    teamId,
    admin.org.id,
  ]);
}

export async function createTeacher(
  db: Db,
  admin: AdminContext,
  input: { name: string; teamId: string; role?: string },
): Promise<{ id: string; name: string; teamName: string }> {
  const name = input.name.trim();
  if (!name || name.length > 40) throw new Error("教师姓名不合法");
  const team = await db.query(
    "SELECT id, name FROM teams WHERE id = $1 AND org_id = $2 AND status = 'active'",
    [input.teamId, admin.org.id],
  );
  if (!team.rows[0]) throw new Error("团队不存在或已停用");
  const id = randomUUID();
  await db.query(
    `INSERT INTO members (id, org_id, display_name, role, status, team_id, team_name)
     VALUES ($1, $2, $3, $4, 'active', $5, $6)`,
    [id, admin.org.id, name, input.role === "mentor" ? "mentor" : "teacher", input.teamId, team.rows[0].name],
  );
  return { id, name, teamName: String(team.rows[0].name) };
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

export async function assignTeacherTeam(
  db: Db,
  admin: AdminContext,
  memberId: string,
  teamId: string,
): Promise<void> {
  const team = await db.query(
    "SELECT id, name FROM teams WHERE id = $1 AND org_id = $2 AND status = 'active'",
    [teamId, admin.org.id],
  );
  if (!team.rows[0]) throw new Error("团队不存在或已停用");
  const result = await db.query(
    "UPDATE members SET team_id = $1, team_name = $2, updated_at = now() WHERE id = $3 AND org_id = $4",
    [teamId, String(team.rows[0].name), memberId, admin.org.id],
  );
  if (result.rowCount !== 1) throw new Error("教师不存在");
}

export async function createTenant(
  db: Db,
  admin: AdminContext,
  input: { name: string; adminUsername: string; adminPassword: string; monthlyBudgetCny?: number },
): Promise<{ tenantId: string; adminId: string; name: string }> {
  if (!admin.isPlatformAdmin) throw new Error("只有平台管理员可以创建租户");
  const name = input.name.trim();
  const username = input.adminUsername.trim();
  if (!name || name.length > 80) throw new Error("租户名称不合法");
  if (!/^[A-Za-z0-9_.-]{3,60}$/.test(username)) throw new Error("租户管理员用户名不合法");
  if (input.adminPassword.length < 12) throw new Error("租户管理员密码至少 12 位");
  const tenantId = randomUUID();
  const adminId = randomUUID();
  const slug = `tenant-${tenantId.slice(0, 8)}`;
  const passwordHash = await hashPassword(input.adminPassword);
  await withTransaction(db, async (client) => {
    await client.query(
      `INSERT INTO organizations (id, name, slug, status, monthly_budget_cny)
       VALUES ($1, $2, $3, 'active', $4)`,
      [tenantId, name, slug, input.monthlyBudgetCny ?? 0],
    );
    await client.query(
      `INSERT INTO admin_users (id, org_id, username, password_hash, status, is_platform_admin)
       VALUES ($1, $2, $3, $4, 'active', false)`,
      [adminId, tenantId, username, passwordHash],
    );
    await client.query(
      `INSERT INTO audit_logs (id, org_id, admin_user_id, action, target, metadata)
       VALUES ($1, $2, $3, 'tenant.create', $4, '{}'::jsonb)`,
      [randomUUID(), admin.homeOrg.id, admin.id, tenantId],
    );
  });
  return { tenantId, adminId, name };
}

export async function switchAdminTenant(
  db: Db,
  sessionToken: string,
  orgId: string | null,
): Promise<void> {
  const session = await db.query(
    `SELECT a.is_platform_admin FROM admin_sessions s
     JOIN admin_users a ON a.id = s.admin_user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND a.status = 'active'`,
    [sha256(sessionToken)],
  );
  if (!session.rows[0]?.is_platform_admin) throw new Error("只有平台管理员可以切换租户");
  if (orgId) {
    const org = await db.query("SELECT id FROM organizations WHERE id = $1 AND status = 'active'", [orgId]);
    if (!org.rows[0]) throw new Error("租户不存在或已停用");
  }
  await db.query("UPDATE admin_sessions SET active_org_id = $1 WHERE token_hash = $2", [orgId, sha256(sessionToken)]);
}

export async function createTenantAdmin(
  db: Db,
  platformAdmin: AdminContext,
  input: { tenantId: string; username: string; password: string },
): Promise<{ id: string; username: string }> {
  if (!platformAdmin.isPlatformAdmin) throw new Error("只有平台管理员可以创建租户管理员");
  const username = input.username.trim();
  if (!/^[A-Za-z0-9_.-]{3,60}$/.test(username)) throw new Error("管理员用户名不合法");
  if (input.password.length < 12) throw new Error("管理员密码至少 12 位");
  const org = await db.query("SELECT id FROM organizations WHERE id = $1 AND status = 'active'", [input.tenantId]);
  if (!org.rows[0]) throw new Error("租户不存在或已停用");
  const id = randomUUID();
  const passwordHash = await hashPassword(input.password);
  await db.query(
    `INSERT INTO admin_users (id, org_id, username, password_hash, status, is_platform_admin)
     VALUES ($1, $2, $3, $4, 'active', false)`,
    [id, input.tenantId, username, passwordHash],
  );
  await db.query(
    `INSERT INTO audit_logs (id, org_id, admin_user_id, action, target, metadata)
     VALUES ($1, $2, $3, 'tenant.admin.create', $4, $5::jsonb)`,
    [randomUUID(), platformAdmin.homeOrg.id, platformAdmin.id, id, JSON.stringify({ tenantId: input.tenantId })],
  );
  return { id, username };
}

export async function resetTenantAdminPassword(
  db: Db,
  platformAdmin: AdminContext,
  tenantId: string,
  adminId: string,
  password: string,
): Promise<void> {
  if (!platformAdmin.isPlatformAdmin) throw new Error("只有平台管理员可以重置租户管理员密码");
  if (password.length < 12) throw new Error("管理员密码至少 12 位");
  const passwordHash = await hashPassword(password);
  const result = await db.query(
    `UPDATE admin_users SET password_hash = $1
     WHERE id = $2 AND org_id = $3 AND is_platform_admin = false`,
    [passwordHash, adminId, tenantId],
  );
  if (result.rowCount !== 1) throw new Error("租户管理员不存在");
  await db.query(
    `INSERT INTO audit_logs (id, org_id, admin_user_id, action, target, metadata)
     VALUES ($1, $2, $3, 'tenant.admin.password_reset', $4, '{}'::jsonb)`,
    [randomUUID(), platformAdmin.homeOrg.id, platformAdmin.id, adminId],
  );
}

export async function setTenantAdminStatus(
  db: Db,
  platformAdmin: AdminContext,
  tenantId: string,
  adminId: string,
  status: "active" | "disabled",
): Promise<void> {
  if (!platformAdmin.isPlatformAdmin) throw new Error("只有平台管理员可以停用租户管理员");
  const result = await db.query(
    `UPDATE admin_users SET status = $1
     WHERE id = $2 AND org_id = $3 AND is_platform_admin = false`,
    [status, adminId, tenantId],
  );
  if (result.rowCount !== 1) throw new Error("租户管理员不存在");
}

export async function updateTeam(
  db: Db,
  admin: AdminContext,
  teamId: string,
  input: { name?: string; status?: "active" | "disabled" },
): Promise<void> {
  const team = await db.query("SELECT id FROM teams WHERE id = $1 AND org_id = $2", [teamId, admin.org.id]);
  if (!team.rows[0]) throw new Error("团队不存在");
  const name = input.name?.trim();
  if (name !== undefined && (!name || name.length > 80)) throw new Error("团队名称不合法");
  await db.query(
    `UPDATE teams SET name = COALESCE($1, name), status = COALESCE($2, status), updated_at = now()
     WHERE id = $3 AND org_id = $4`,
    [name ?? null, input.status ?? null, teamId, admin.org.id],
  );
}

export async function updateTeacher(
  db: Db,
  admin: AdminContext,
  memberId: string,
  input: { name?: string; status?: "active" | "disabled"; teamId?: string },
): Promise<void> {
  const member = await db.query(
    "SELECT id FROM members WHERE id = $1 AND org_id = $2",
    [memberId, admin.org.id],
  );
  if (!member.rows[0]) throw new Error("导师不存在");
  const name = input.name?.trim();
  if (name !== undefined && (!name || name.length > 40)) throw new Error("导师姓名不合法");
  let teamName: string | null | undefined;
  if (input.teamId !== undefined) {
    if (input.teamId) {
      const team = await db.query(
        "SELECT name FROM teams WHERE id = $1 AND org_id = $2 AND status = 'active'",
        [input.teamId, admin.org.id],
      );
      if (!team.rows[0]) throw new Error("团队不存在或已停用");
      teamName = String(team.rows[0].name);
    } else {
      teamName = null;
    }
  }
  await db.query(
    `UPDATE members SET display_name = COALESCE($1, display_name),
       status = COALESCE($2, status),
       team_id = CASE WHEN $3::boolean THEN $4 ELSE team_id END,
       team_name = CASE WHEN $3::boolean THEN $5 ELSE team_name END,
       updated_at = now()
     WHERE id = $6 AND org_id = $7`,
    [name ?? null, input.status ?? null, input.teamId !== undefined, input.teamId || null, teamName ?? null, memberId, admin.org.id],
  );
}

export async function revokeMemberDevices(db: Db, admin: AdminContext, memberId: string): Promise<void> {
  const result = await db.query(
    "UPDATE devices SET revoked_at = now() WHERE member_id = $1 AND member_id IN (SELECT id FROM members WHERE org_id = $2)",
    [memberId, admin.org.id],
  );
  if (result.rowCount === 0) throw new Error("没有可吊销的设备");
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
