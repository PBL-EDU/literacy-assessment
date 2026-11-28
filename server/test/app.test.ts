import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { runMigrations, type Db } from "../src/db/index.js";
import { hashPassword, sha256 } from "../src/security/tokens.js";
import { authenticateAdmin, createInvite, createTeam, createTeacher, createTenant, createTenantAdmin, redeemInvite, switchAdminTenant, type AdminContext } from "../src/auth/service.js";
import { adminLogin } from "../src/auth/service.js";

class PgliteDb {
  constructor(private readonly db: PGlite) {}

  async query(text: string, values: unknown[] = []): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    // PGlite's prepared-statement path accepts one command; migrations are a
    // multi-statement script in production PostgreSQL.
    if (/(CREATE TABLE|ALTER TABLE|UPDATE admin_users)/i.test(text) && text.includes(";")) {
      await this.db.exec(text);
      return { rows: [], rowCount: 0 };
    }
    const result = await this.db.query<Record<string, unknown>>(text, values);
    return { rows: result.rows, rowCount: result.rows.length };
  }

  async connect(): Promise<{ query: typeof this.query; release: () => void }> {
    return { query: this.query.bind(this), release: () => undefined };
  }

  async end(): Promise<void> {
    await this.db.close();
  }
}

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgres://test/test",
  AUTH_SECRET: "a".repeat(40),
  MASTER_KEY: "m".repeat(40),
  PUBLIC_URL: "http://localhost:3010",
  ADMIN_COOKIE_SECURE: "false",
});

test("auth, invite, member and framework APIs work end to end", async () => {
  const pglite = new PGlite();
  const db = new PgliteDb(pglite) as unknown as Db;
  await runMigrations(db);
  await db.query(
    "INSERT INTO organizations (id, name, slug) VALUES ('org1', '白日梦行动', 'dream')",
  );
  const passwordHash = await hashPassword("admin-password-123");
  await db.query(
    `INSERT INTO admin_users (id, org_id, username, password_hash, status, is_platform_admin)
     VALUES ('admin1', 'org1', 'admin', $1, 'active', true)`,
    [passwordHash],
  );
  await db.query(
    `INSERT INTO invites (id, org_id, code_hash, expires_at, max_uses, created_by)
     VALUES ('invite1', 'org1', $1, now() + interval '1 day', 1, 'admin1')`,
    [sha256("ABC23456")],
  );
  await db.query(
    `INSERT INTO framework_versions
     (id, org_id, framework_id, name, version, file_hash, markdown, status, published_by, published_at)
     VALUES ('fv1', 'org1', 'dream', '白日梦框架', '1', 'sha256:test', $1, 'published', 'admin1', now())`,
    [
      `---
framework_id: dream
name: 白日梦框架
version: "1"
---

| 路径 | 目标ID | 目标 | 维度 | L1 | L2 |
| --- | --- | --- | --- | --- | --- |
| 自我认知/识别情绪 | SDU.1 | 识别情绪 | 自我认知 | 能说出 | 能解释 |
`,
    ],
  );
  const app = await buildApp({ config, db });

  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);

  const login = await app.inject({
    method: "POST",
    url: "/admin/login",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: "username=admin&password=admin-password-123",
  });
  assert.equal(login.statusCode, 302);
  const cookie = login.headers["set-cookie"];
  assert.ok(cookie);
  const admin = await app.inject({ method: "GET", url: "/admin", headers: { cookie: String(cookie) } });
  assert.equal(admin.statusCode, 200);

  const boundary = "----literacy-test-boundary";
  const frameworkMarkdown = `---
framework_id: uploaded
name: 上传测试框架
version: "1"
---

| 路径 | 目标ID | 目标 | 维度 | L1 | L2 |
| --- | --- | --- | --- | --- | --- |
| 一级/二级 | G.1 | 目标 | 维度 | 初 | 进 |
`;
  const uploadBody = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="framework.md"\r\nContent-Type: text/markdown\r\n\r\n${frameworkMarkdown}\r\n--${boundary}--\r\n`,
    "utf8",
  );
  const upload = await app.inject({
    method: "POST",
    url: "/admin/frameworks/upload",
    headers: { cookie: String(cookie), "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: uploadBody,
  });
  assert.equal(upload.statusCode, 302, upload.body);
  const uploaded = await db.query("SELECT id FROM framework_versions WHERE framework_id = 'uploaded'");
  assert.equal(uploaded.rows.length, 1);
  const publish = await app.inject({
    method: "POST",
    url: `/admin/frameworks/${uploaded.rows[0].id}/publish`,
    headers: { cookie: String(cookie) },
  });
  assert.equal(publish.statusCode, 302, publish.body);

  const redeem = await app.inject({
    method: "POST",
    url: "/api/auth/redeem-invite",
    payload: { code: "ABC23456", displayName: "林老师", deviceName: "测试设备" },
  });
  assert.equal(redeem.statusCode, 200, redeem.body);
  const token = redeem.json<{ accessToken: string }>().accessToken;
  const me = await app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${token}` } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json<{ member: { displayName: string } }>().member.displayName, "林老师");

  const frameworks = await app.inject({
    method: "GET",
    url: "/api/frameworks",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(frameworks.statusCode, 200);
  assert.equal(frameworks.json<{ frameworks: unknown[] }>().frameworks.length, 2);

  const adminContext: AdminContext = {
    id: "admin1",
    username: "admin",
    org: { id: "org1", name: "白日梦行动", slug: "dream" },
    homeOrg: { id: "org1", name: "白日梦行动", slug: "dream" },
    isPlatformAdmin: true,
  };
  const team = await createTeam(db, adminContext, "测试团队");
  const teacher = await createTeacher(db, adminContext, { name: "绑定老师", teamId: team.id });
  const invite = await createInvite(db, adminContext, {
    expiresInHours: 1,
    maxUses: 1,
    teacherId: teacher.id,
    teamId: team.id,
  });
  const bound = await redeemInvite(db, config, {
    code: invite.code,
    displayName: "错误的名字",
    deviceName: "绑定设备",
  });
  assert.equal(bound.member.displayName, "绑定老师");
  assert.equal(bound.member.teamName, "测试团队");
  assert.equal(bound.member.teamId, team.id);

  const tenant = await createTenant(db, adminContext, {
    name: "第二所学校",
    adminUsername: "tenant-admin",
    adminPassword: "tenant-password-123",
    monthlyBudgetCny: 100,
  });
  assert.ok(tenant.tenantId);
  const tenantLogin = await adminLogin(db, config, "tenant-admin", "tenant-password-123");
  assert.equal(tenantLogin.admin.org.name, "第二所学校");
  assert.equal(tenantLogin.admin.isPlatformAdmin, false);

  const secondAdmin = await createTenantAdmin(db, adminContext, {
    tenantId: tenant.tenantId,
    username: "tenant-admin-2",
    password: "tenant-password-456",
  });
  assert.equal(secondAdmin.username, "tenant-admin-2");
  const switched = await adminLogin(db, config, "admin", "admin-password-123");
  await switchAdminTenant(db, switched.token, tenant.tenantId);
  const switchedContext = await authenticateAdmin(db, switched.token);
  assert.equal(switchedContext?.org.name, "第二所学校");
  assert.equal(switchedContext?.homeOrg.name, "白日梦行动");

  await app.close();
  await db.end();
});
