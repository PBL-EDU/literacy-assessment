/* eslint-disable */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Db } from "../db/index.js";
import { requireAdmin } from "../auth/http.js";
import { adminPage, escapeHtml } from "../http/html.js";
import { encryptSecret, keyFingerprint } from "../security/secrets.js";

const settingsSchema = z.object({
  budgetCny: z.coerce.number().min(0).max(10_000_000),
  deepseekKey: z.string().max(400).optional().default(""),
});

export async function registerSettingsRoutes(app: FastifyInstance, db: Db, config: AppConfig): Promise<void> {
  app.get("/admin/settings", async (request, reply) => {
    const admin = await requireAdmin(db, request);
    const [org, credential] = await Promise.all([
      db.query("SELECT monthly_budget_cny FROM organizations WHERE id = $1", [admin.org.id]),
      db.query("SELECT key_fingerprint FROM org_credentials WHERE org_id = $1 AND provider = 'deepseek'", [admin.org.id]),
    ]);
    return reply.type("text/html").send(settingsPage(
      admin.username,
      Number(org.rows[0]?.monthly_budget_cny ?? 0),
      String(credential.rows[0]?.key_fingerprint ?? ""),
      "",
    ));
  });

  app.post("/admin/settings", async (request, reply) => {
    const admin = await requireAdmin(db, request);
    const input = settingsSchema.safeParse(request.body ?? {});
    if (!input.success) {
      return reply.code(400).type("text/html").send(settingsPage(admin.username, 0, "", "参数不正确"));
    }
    await db.query("UPDATE organizations SET monthly_budget_cny = $1, updated_at = now() WHERE id = $2", [
      input.data.budgetCny,
      admin.org.id,
    ]);
    if (input.data.deepseekKey.trim()) {
      const encrypted = encryptSecret(input.data.deepseekKey.trim(), config.masterKey);
      const fingerprint = keyFingerprint(input.data.deepseekKey.trim());
      await db.query(
        `INSERT INTO org_credentials (id, org_id, provider, encrypted_key, key_fingerprint)
         VALUES ($1, $2, 'deepseek', $3, $4)
         ON CONFLICT (org_id, provider) DO UPDATE
         SET encrypted_key = EXCLUDED.encrypted_key,
             key_fingerprint = EXCLUDED.key_fingerprint,
             updated_at = now()`,
        [randomUUID(), admin.org.id, encrypted, fingerprint],
      );
    }
    await db.query(
      `INSERT INTO audit_logs (id, org_id, admin_user_id, action, target, metadata)
       VALUES ($1, $2, $3, 'settings.update', 'organization', $4::jsonb)`,
      [randomUUID(), admin.org.id, admin.id, JSON.stringify({ budgetCny: input.data.budgetCny, keyUpdated: Boolean(input.data.deepseekKey.trim()) })],
    );
    return reply.redirect("/admin/settings?saved=1");
  });
}


function settingsPage(username: string, budget: number, fingerprint: string, error: string): string {
  return adminPage(
    "设置",
    `<div class="card">
      <h1>组织设置</h1>
      <p><a href="/admin">返回总览</a> · <a href="/admin/prices">模型价格</a></p>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
      <p class="muted">组织 DeepSeek Key 只保存在服务端，使用 MASTER_KEY 加密；不会下发给插件。</p>
      <p>当前 Key：${fingerprint ? `已配置（指纹 ${escapeHtml(fingerprint)}）` : "未配置"}</p>
      <form method="post" action="/admin/settings">
        <label>组织月度预算（人民币；0 表示不限）</label>
        <input type="number" step="0.01" name="budgetCny" value="${budget}">
        <label>DeepSeek API Key（留空表示不修改）</label>
        <input type="password" name="deepseekKey" autocomplete="new-password" placeholder="sk-...">
        <p><button type="submit">保存设置</button></p>
      </form>
      <p class="muted">模型价格表在后续批次补管理界面；未配置价格时估算费用为 0。</p>
    </div>`,
    username,
  );
}
