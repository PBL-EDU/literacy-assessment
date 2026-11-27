/* eslint-disable */
import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const { Pool } = pg;

export type Db = pg.Pool;

export function createPool(databaseUrl: string): Db {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  db: Db,
  text: string,
  values: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return db.query<T>(text, values);
}

export async function withTransaction<T>(db: Db, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function runMigrations(db: Db, migrationsDir = process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), "migrations")): Promise<number> {
  await ensureMigrationTable(db);
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  let applied = 0;
  for (const file of files) {
    const id = file.replace(/\.sql$/, "");
    const existing = await db.query("SELECT 1 FROM schema_migrations WHERE id = $1", [id]);
    if (existing.rowCount) continue;
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
      await client.query("COMMIT");
      applied += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return applied;
}

export async function ensureMigrationTable(db: Db): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}
