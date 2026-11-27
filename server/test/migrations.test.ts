import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

test("SQL migrations create the organization schema", async () => {
  const db = new PGlite();
  const dir = path.resolve(process.cwd(), "migrations");
  const files = (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    await db.exec(await readFile(path.join(dir, file), "utf8"));
  }
  const tables = await db.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
  );
  const names = new Set(tables.rows.map((row) => row.table_name));
  for (const table of [
    "organizations",
    "admin_users",
    "admin_sessions",
    "members",
    "invites",
    "devices",
    "framework_versions",
    "usage_events",
    "quota_periods",
    "org_credentials",
    "audit_logs",
    "ai_prices",
  ]) {
    assert.ok(names.has(table), `missing table ${table}`);
  }
  await db.close();
});
