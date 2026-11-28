/* eslint-disable */
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

  app.get("/", async (_request, reply) => {
    return reply.type("text/html").send(`<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>白日梦行动 · 素养教师工作台</title>
<style>body{margin:0;background:#eef3f4;color:#1f2933;font-family:"Microsoft YaHei","Segoe UI",sans-serif;display:grid;place-items:center;min-height:100vh}main{background:#fff;border:1px solid #d9e2e8;border-radius:12px;padding:32px 38px;max-width:520px;box-shadow:0 12px 35px rgba(15,23,42,.08)}h1{font-size:22px;margin:0 0 8px}p{font-size:14px;line-height:1.8;color:#4b5563}a{color:#0f766e;font-weight:700}</style></head>
<body><main><h1>白日梦行动 · 素养教师工作台</h1><p>组织服务已运行。</p><p>教师请在 Obsidian 插件中使用邀请码加入组织。</p><p><a href="/admin/login">组织管理员登录</a> · <a href="/health">服务状态</a></p></main></body></html>`);
  });

  app.get("/health", async (_request, reply) => {
    try {
      await db.query("SELECT 1");
      return reply.send({ ok: true, service: "literacy-assessment-server", version: "0.7.0" });
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
