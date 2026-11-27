import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Db } from "../db/index.js";
import { requireMember } from "../auth/http.js";
import { getOrgKey, assertBudget, recordUsage } from "../usage/service.js";

const chatSchema = z.object({
  model: z.string().min(1).max(80),
  messages: z.array(z.record(z.string(), z.unknown())).min(1),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().max(128_000).optional(),
  response_format: z.record(z.string(), z.unknown()).optional(),
});

function upstreamUrl(config: AppConfig, path: string): string {
  return `${config.deepseekApiBase}${path}`;
}

function fieldText(value: unknown): string {
  if (value && typeof value === "object" && "value" in value) {
    return String((value as { value: unknown }).value ?? "");
  }
  return "";
}

export async function registerGatewayRoutes(app: FastifyInstance, db: Db, config: AppConfig): Promise<void> {
  app.post("/api/ai/chat", async (request, reply) => {
    const auth = await requireMember(db, config, request);
    const input = chatSchema.safeParse(request.body ?? {});
    if (!input.success) return reply.code(400).send({ error: "聊天请求参数不正确" });
    if (!config.allowedModels.includes(input.data.model)) {
      return reply.code(400).send({ error: `组织不允许使用模型：${input.data.model}` });
    }
    await assertBudget(db, auth.org.id);
    const key = await getOrgKey(db, config, auth.org.id);
    const requestId = request.id;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);
    let response: Response;
    try {
      response = await fetch(upstreamUrl(config, "/v1/chat/completions"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(input.data),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    if (!response.ok) {
      await recordUsage(db, {
        orgId: auth.org.id,
        memberId: auth.member.id,
        requestId,
        kind: "chat",
        model: input.data.model,
        status: "error",
      }).catch(() => undefined);
      request.log.warn({ status: response.status, upstream: "deepseek" }, "chat upstream error");
      return reply.code(response.status).type("application/json").send(text);
    }
    let usage: { prompt_tokens?: number; completion_tokens?: number } = {};
    try {
      const parsed = JSON.parse(text) as { usage?: { prompt_tokens?: number; completion_tokens?: number } };
      usage = parsed.usage ?? {};
    } catch {
      // Upstream returned a non-JSON body; pass it through and record zero usage.
    }
    const recorded = await recordUsage(db, {
      orgId: auth.org.id,
      memberId: auth.member.id,
      requestId,
      kind: "chat",
      model: input.data.model,
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
    });
    reply.header("X-Usage-Estimated-Cny", String(recorded.estimatedCostCny));
    return reply.type("application/json").send(text);
  });

  app.post("/api/ai/ocr", async (request, reply) => {
    const auth = await requireMember(db, config, request);
    await assertBudget(db, auth.org.id);
    const key = await getOrgKey(db, config, auth.org.id);
    const data = await request.file({ limits: { fileSize: 100 * 1024 * 1024 } });
    if (!data) return reply.code(400).send({ error: "没有收到 OCR 文件" });
    const buffer = await data.toBuffer();
    if (data.file.truncated) return reply.code(413).send({ error: "OCR 文件超过 100 MB" });
    const form = new FormData();
    form.append("file", new Blob([buffer as unknown as BlobPart], { type: data.mimetype }), data.filename);
    const purpose = fieldText(data.fields.purpose);
    if (purpose) form.append("purpose", purpose);
    const response = await fetch(upstreamUrl(config, "/v1/tools/ocr"), {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      body: form,
      signal: AbortSignal.timeout(180_000),
    });
    const text = await response.text();
    if (!response.ok) {
      await recordUsage(db, {
        orgId: auth.org.id,
        memberId: auth.member.id,
        requestId: request.id,
        kind: "ocr",
        model: "deepseek-ocr",
        status: "error",
      }).catch(() => undefined);
      return reply.code(response.status).type("application/json").send(text);
    }
    let pageCount = 0;
    try {
      const parsed = JSON.parse(text) as { page_count?: number; pages?: unknown[] };
      pageCount = Number(parsed.page_count) || (Array.isArray(parsed.pages) ? parsed.pages.length : 0);
    } catch {
      // Pass through; pages remain zero.
    }
    const recorded = await recordUsage(db, {
      orgId: auth.org.id,
      memberId: auth.member.id,
      requestId: request.id,
      kind: "ocr",
      model: "deepseek-ocr",
      ocrPages: pageCount,
    });
    reply.header("X-Usage-Estimated-Cny", String(recorded.estimatedCostCny));
    return reply.type("application/json").send(text);
  });

  app.post("/api/ai/asr", async (request, reply) => {
    const auth = await requireMember(db, config, request);
    await assertBudget(db, auth.org.id);
    const key = await getOrgKey(db, config, auth.org.id);
    const data = await request.file({ limits: { fileSize: 32 * 1024 * 1024 } });
    if (!data) return reply.code(400).send({ error: "没有收到音频文件" });
    const buffer = await data.toBuffer();
    if (data.file.truncated) return reply.code(413).send({ error: "音频文件超过 32 MB" });
    const form = new FormData();
    form.append("file", new Blob([buffer as unknown as BlobPart], { type: data.mimetype }), data.filename);
    for (const keyName of ["model", "language", "response_format"]) {
      const value = fieldText(data.fields[keyName]);
      if (value) form.append(keyName, value);
    }
    const response = await fetch(upstreamUrl(config, "/v1/tools/asr"), {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      body: form,
      signal: AbortSignal.timeout(180_000),
    });
    const text = await response.text();
    if (!response.ok) {
      await recordUsage(db, {
        orgId: auth.org.id,
        memberId: auth.member.id,
        requestId: request.id,
        kind: "asr",
        model: "deepseek-asr",
        status: "error",
      }).catch(() => undefined);
      return reply.code(response.status).type("application/json").send(text);
    }
    let durationSeconds = 0;
    try {
      const parsed = JSON.parse(text) as { duration_ms?: number };
      durationSeconds = Math.max(0, Number(parsed.duration_ms ?? 0) / 1000);
    } catch {
      // Pass through; duration remains zero.
    }
    const recorded = await recordUsage(db, {
      orgId: auth.org.id,
      memberId: auth.member.id,
      requestId: request.id,
      kind: "asr",
      model: "deepseek-asr",
      asrSeconds: durationSeconds,
    });
    reply.header("X-Usage-Estimated-Cny", String(recorded.estimatedCostCny));
    return reply.type("application/json").send(text);
  });

  app.get("/api/usage/me", async (request, reply) => {
    const auth = await requireMember(db, config, request);
    const usage = await db.query(
      `SELECT coalesce(sum(estimated_cost_cny),0) AS cost,
              coalesce(sum(input_tokens + output_tokens),0) AS tokens,
              count(*)::int AS events
       FROM usage_events
       WHERE org_id = $1 AND member_id = $2 AND created_at >= date_trunc('month', now())`,
      [auth.org.id, auth.member.id],
    );
    const row = usage.rows[0] as Record<string, unknown>;
    return reply.send({
      month: new Date().toISOString().slice(0, 7),
      estimatedCostCny: Number(row?.cost ?? 0),
      totalTokens: Number(row?.tokens ?? 0),
      events: Number(row?.events ?? 0),
    });
  });
}
