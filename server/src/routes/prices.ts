import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { Db } from "../db/index.js";
import { requireAdmin } from "../auth/http.js";
import { adminPage, escapeHtml } from "../http/html.js";

export async function registerPriceRoutes(app: FastifyInstance, db: Db, config: AppConfig): Promise<void> {
  app.get("/admin/prices", async (request, reply) => {
    const admin = await requireAdmin(db, request);
    return reply.type("text/html").send(await pricePage(db, admin.username));
  });

  app.post("/admin/prices", async (request, reply) => {
    const admin = await requireAdmin(db, request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const rows = await db.query("SELECT model FROM ai_prices ORDER BY model");
    for (const row of rows.rows as Array<{ model: string }>) {
      const model = row.model;
      const input = numberOrNull(body[`input_${model}`]);
      const output = numberOrNull(body[`output_${model}`]);
      const ocr = numberOrNull(body[`ocr_${model}`]);
      const asr = numberOrNull(body[`asr_${model}`]);
      if (input === null || output === null || ocr === null || asr === null) continue;
      await db.query(
        `UPDATE ai_prices
         SET input_per_million_cny = $1, output_per_million_cny = $2,
             ocr_per_page_cny = $3, asr_per_second_cny = $4, updated_at = now()
         WHERE model = $5`,
        [input, output, ocr, asr, model],
      );
    }
    await db.query(
      `INSERT INTO audit_logs (id, org_id, admin_user_id, action, target, metadata)
       VALUES ($1, $2, $3, 'prices.update', 'ai_prices', '{}'::jsonb)`,
      [randomUUID(), admin.org.id, admin.id],
    );
    return reply.redirect("/admin/prices");
  });

  void config;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "") return 0;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

async function pricePage(db: Db, username: string): Promise<string> {
  const result = await db.query("SELECT * FROM ai_prices ORDER BY model");
  const rows = result.rows as Array<Record<string, unknown>>;
  const table = rows
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.model)}</td>
        <td><input type="number" step="0.0001" name="input_${escapeHtml(row.model)}" value="${escapeHtml(row.input_per_million_cny)}"></td>
        <td><input type="number" step="0.0001" name="output_${escapeHtml(row.model)}" value="${escapeHtml(row.output_per_million_cny)}"></td>
        <td><input type="number" step="0.0001" name="ocr_${escapeHtml(row.model)}" value="${escapeHtml(row.ocr_per_page_cny)}"></td>
        <td><input type="number" step="0.000001" name="asr_${escapeHtml(row.model)}" value="${escapeHtml(row.asr_per_second_cny)}"></td>
      </tr>`,
    )
    .join("");
  return adminPage(
    "模型价格",
    `<div class="card">
      <h1>DeepSeek 模型价格</h1>
      <p><a href="/admin">返回总览</a> · <a href="/admin/settings">组织设置</a></p>
      <p class="muted">用于“估算费用”和月度预算拦截；实际账单以 DeepSeek 官方为准。价格为 0 时不产生估算费用。</p>
      <form method="post" action="/admin/prices">
        <table>
          <tr><th>模型</th><th>输入 / 百万 token（元）</th><th>输出 / 百万 token（元）</th><th>OCR / 页（元）</th><th>ASR / 秒（元）</th></tr>
          ${table || "<tr><td colspan='5'>没有价格记录。</td></tr>"}
        </table>
        <p><button type="submit">保存价格</button></p>
      </form>
    </div>`,
    username,
  );
}
