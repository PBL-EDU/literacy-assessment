/* eslint-disable */
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig } from "../config.js";
import { createPool, runMigrations } from "../db/index.js";
import { hashPassword } from "../security/tokens.js";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

const config = loadConfig();
const orgName = arg("org") ?? (await ask("组织名称："));
const slug = (arg("slug") ?? orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-")).replace(/^-|-$/g, "") || "organization";
const username = arg("username") ?? (await ask("管理员用户名："));
const password = process.env.ADMIN_PASSWORD ?? (await ask("管理员密码（至少 12 位）："));
if (!orgName || !username || password.length < 12) {
  console.error("组织名称、管理员用户名和至少 12 位密码是必需的。");
  process.exit(1);
}

const db = createPool(config.databaseUrl);
try {
  await runMigrations(db);
  const existing = await db.query("SELECT 1 FROM organizations LIMIT 1");
  if (existing.rowCount) {
    console.error("已存在组织；v0.5 MVP 只允许一个组织。");
    process.exit(1);
  }
  const orgId = randomUUID();
  const adminId = randomUUID();
  const passwordHash = await hashPassword(password);
  await db.query("BEGIN");
  try {
    await db.query(
      "INSERT INTO organizations (id, name, slug, status) VALUES ($1, $2, $3, 'active')",
      [orgId, orgName, slug],
    );
    await db.query(
      `INSERT INTO admin_users (id, org_id, username, password_hash, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [adminId, orgId, username, passwordHash],
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
  console.log(`组织已创建：${orgName} (${slug})`);
  console.log(`管理员：${username}`);
  console.log(`后台：${config.publicUrl}/admin/login`);
} finally {
  await db.end();
}
