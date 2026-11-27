import { randomUUID } from "node:crypto";
import type { Db } from "../db/index.js";
import type { AdminContext } from "../auth/service.js";
import { parseFrameworkMarkdown, type ParsedFramework } from "./parser.js";

export interface FrameworkRow {
  id: string;
  framework_id: string;
  name: string;
  version: string;
  file_hash: string;
  markdown: string;
  status: string;
  published_at: Date | null;
}

export interface PublishedFramework {
  frameworkId: string;
  name: string;
  version: string;
  hash: string;
  markdown: string;
  parsed: ParsedFramework;
}

export async function uploadFramework(
  db: Db,
  admin: AdminContext,
  markdown: string,
): Promise<{ row: FrameworkRow; parsed: ParsedFramework }> {
  const parsed = parseFrameworkMarkdown(markdown);
  if (parsed.errors.length) {
    throw Object.assign(new Error(`框架校验失败：${parsed.errors.join("；")}`), { statusCode: 400 });
  }
  const id = randomUUID();
  try {
    const result = await db.query(
      `INSERT INTO framework_versions
       (id, org_id, framework_id, name, version, file_hash, markdown, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')
       RETURNING *`,
      [id, admin.org.id, parsed.frameworkId, parsed.name, parsed.version, parsed.hash, markdown],
    );
    await audit(db, admin, "framework.upload", parsed.frameworkId, {
      version: parsed.version,
      goals: parsed.goals.length,
    });
    return { row: result.rows[0] as FrameworkRow, parsed };
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw Object.assign(new Error("这个框架版本已经存在"), { statusCode: 409 });
    }
    throw error;
  }
}

export async function listFrameworkVersions(db: Db, orgId: string): Promise<FrameworkRow[]> {
  const result = await db.query(
    `SELECT * FROM framework_versions WHERE org_id = $1 ORDER BY created_at DESC`,
    [orgId],
  );
  return result.rows as FrameworkRow[];
}

export async function publishFramework(db: Db, admin: AdminContext, id: string): Promise<FrameworkRow> {
  const result = await db.query(
    `UPDATE framework_versions
     SET status = 'published', published_by = $1, published_at = now()
     WHERE id = $2 AND org_id = $3
     RETURNING *`,
    [admin.id, id, admin.org.id],
  );
  const row = result.rows[0] as FrameworkRow | undefined;
  if (!row) throw Object.assign(new Error("找不到框架版本"), { statusCode: 404 });
  await audit(db, admin, "framework.publish", row.framework_id, { version: row.version });
  return row;
}

export async function disableFramework(db: Db, admin: AdminContext, id: string): Promise<FrameworkRow> {
  const result = await db.query(
    `UPDATE framework_versions SET status = 'disabled'
     WHERE id = $1 AND org_id = $2 RETURNING *`,
    [id, admin.org.id],
  );
  const row = result.rows[0] as FrameworkRow | undefined;
  if (!row) throw Object.assign(new Error("找不到框架版本"), { statusCode: 404 });
  await audit(db, admin, "framework.disable", row.framework_id, { version: row.version });
  return row;
}

export async function listPublishedFrameworks(db: Db, orgId: string): Promise<PublishedFramework[]> {
  const result = await db.query(
    `SELECT DISTINCT ON (framework_id) *
     FROM framework_versions
     WHERE org_id = $1 AND status = 'published'
     ORDER BY framework_id, published_at DESC`,
    [orgId],
  );
  return (result.rows as FrameworkRow[]).map(toPublished);
}

export async function getPublishedFramework(
  db: Db,
  orgId: string,
  frameworkId: string,
): Promise<PublishedFramework | null> {
  const result = await db.query(
    `SELECT * FROM framework_versions
     WHERE org_id = $1 AND framework_id = $2 AND status = 'published'
     ORDER BY published_at DESC LIMIT 1`,
    [orgId, frameworkId],
  );
  const row = result.rows[0] as FrameworkRow | undefined;
  return row ? toPublished(row) : null;
}

function toPublished(row: FrameworkRow): PublishedFramework {
  return {
    frameworkId: row.framework_id,
    name: row.name,
    version: row.version,
    hash: row.file_hash,
    markdown: row.markdown,
    parsed: parseFrameworkMarkdown(row.markdown),
  };
}

async function audit(db: Db, admin: AdminContext, action: string, target: string, metadata: unknown): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (id, org_id, admin_user_id, action, target, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [randomUUID(), admin.org.id, admin.id, action, target, JSON.stringify(metadata)],
  );
}
