/* eslint-disable */
import { loadConfig } from "../config.js";
import { createPool, runMigrations } from "../db/index.js";

const config = loadConfig();
const db = createPool(config.databaseUrl);
try {
  const count = await runMigrations(db);
  console.log(`Migrations applied: ${count}`);
} finally {
  await db.end();
}
