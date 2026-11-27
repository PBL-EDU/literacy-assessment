/* eslint-disable */
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3010),
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  MASTER_KEY: z.string().min(32, "MASTER_KEY must be at least 32 characters"),
  PUBLIC_URL: z.string().url().default("http://localhost:3010"),
  ADMIN_COOKIE_SECURE: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  DEEPSEEK_API_BASE: z.string().url().default("https://api.deepseek.com"),
  LOG_LEVEL: z.string().default("info"),
  ALLOWED_MODELS: z.string().default("deepseek-chat,deepseek-flash"),
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  databaseUrl: string;
  authSecret: string;
  masterKey: string;
  publicUrl: string;
  adminCookieSecure: boolean;
  deepseekApiBase: string;
  logLevel: string;
  allowedModels: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.parse(env);
  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    authSecret: parsed.AUTH_SECRET,
    masterKey: parsed.MASTER_KEY,
    publicUrl: parsed.PUBLIC_URL.replace(/\/$/, ""),
    adminCookieSecure: parsed.ADMIN_COOKIE_SECURE,
    deepseekApiBase: parsed.DEEPSEEK_API_BASE.replace(/\/$/, ""),
    logLevel: parsed.LOG_LEVEL,
    allowedModels: parsed.ALLOWED_MODELS.split(",").map((m) => m.trim()).filter(Boolean),
  };
}
