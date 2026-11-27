import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool, runMigrations } from "./db/index.js";

const config = loadConfig();
const db = createPool(config.databaseUrl);
await runMigrations(db);
const app = await buildApp({ config, db });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await db.end();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(`listening on ${config.publicUrl}`);
} catch (error) {
  app.log.error(error);
  await db.end();
  process.exit(1);
}
