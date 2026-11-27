import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { runMigrations, type Db } from "../src/db/index.js";
import { hashPassword, sha256 } from "../src/security/tokens.js";

class PgliteDb {
  constructor(private readonly db: PGlite) {}

  async query(text: string, values: unknown[] = []): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    // PGlite's prepared-statement path accepts one command; migrations are a
    // multi-statement script in production PostgreSQL.
    if (/CREATE TABLE/i.test(text) && text.includes(";")) {
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
    `INSERT INTO admin_users (id, org_id, username, password_hash, status)
     VALUES ('admin1', 'org1', 'admin', $1, 'active')`,
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
  assert.equal(frameworks.json<{ frameworks: unknown[] }>().frameworks.length, 1);

  await app.close();
  await db.end();
});
