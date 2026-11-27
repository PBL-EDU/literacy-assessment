import type { FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import type { Db } from "../db/index.js";
import { authenticate, authenticateAdmin, type AdminContext, type AuthContext } from "./service.js";

export function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

export async function requireMember(
  db: Db,
  config: AppConfig,
  request: FastifyRequest,
): Promise<AuthContext> {
  const token = bearerToken(request);
  if (!token) throw Object.assign(new Error("未登录"), { statusCode: 401 });
  const context = await authenticate(db, config, token);
  if (!context) throw Object.assign(new Error("登录已失效"), { statusCode: 401 });
  return context;
}

export async function optionalAdmin(
  db: Db,
  request: FastifyRequest,
): Promise<AdminContext | null> {
  const token = request.cookies?.la_admin;
  if (!token) return null;
  return authenticateAdmin(db, token);
}

export async function requireAdmin(db: Db, request: FastifyRequest): Promise<AdminContext> {
  const admin = await optionalAdmin(db, request);
  if (!admin) throw Object.assign(new Error("需要管理员登录"), { statusCode: 401 });
  return admin;
}
