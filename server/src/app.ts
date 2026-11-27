import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import type { AppConfig } from "./config.js";
import type { Db } from "./db/index.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerFrameworkRoutes } from "./routes/frameworks.js";
import { registerGatewayRoutes } from "./routes/gateway.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerPriceRoutes } from "./routes/prices.js";

export interface BuildOptions {
  config: AppConfig;
  db: Db;
}

export async function buildApp({ config, db }: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers.set-cookie",
          "body.password",
          "body.refreshToken",
          "body.code",
        ],
        censor: "[redacted]",
      },
    },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  });

  await app.register(cookie);
  await app.register(formbody);
  await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });

  app.get("/health", async (_request, reply) => {
    try {
      await db.query("SELECT 1");
      return reply.send({ ok: true, service: "literacy-assessment-server", version: "0.5.0" });
    } catch {
      return reply.code(503).send({ ok: false, service: "literacy-assessment-server" });
    }
  });

  await registerAuthRoutes(app, db, config);
  await registerFrameworkRoutes(app, db, config);
  await registerGatewayRoutes(app, db, config);
  await registerSettingsRoutes(app, db, config);
  await registerPriceRoutes(app, db, config);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = typeof error.statusCode === "number" ? error.statusCode : 500;
    if (statusCode >= 500) request.log.error({ err: error }, "request failed");
    return reply.code(statusCode).send({
      error: statusCode >= 500 ? "服务器内部错误" : error.message,
    });
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/admin")) {
      return reply.code(404).type("text/html").send("<!doctype html><meta charset='utf-8'><p>页面不存在。</p>");
    }
    return reply.code(404).send({ error: "not_found" });
  });

  return app;
}
