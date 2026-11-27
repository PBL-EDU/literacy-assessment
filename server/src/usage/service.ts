import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import { withTransaction, type Db } from "../db/index.js";
import { decryptSecret } from "../security/secrets.js";

export interface AiPrice {
  model: string;
  inputPerMillion: number;
  outputPerMillion: number;
  ocrPerPage: number;
  asrPerSecond: number;
}

export interface UsageInput {
  orgId: string;
  memberId: string;
  requestId: string;
  kind: "chat" | "ocr" | "asr";
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  ocrPages?: number;
  asrSeconds?: number;
  status?: "success" | "error" | "blocked";
}

export interface UsageResult {
  estimatedCostCny: number;
  budgetCny: number;
  spentCny: number;
}

export async function getOrgKey(db: Db, config: AppConfig, orgId: string): Promise<string> {
  const result = await db.query(
    `SELECT encrypted_key FROM org_credentials WHERE org_id = $1 AND provider = 'deepseek' LIMIT 1`,
    [orgId],
  );
  const row = result.rows[0] as { encrypted_key?: string } | undefined;
  if (!row?.encrypted_key) {
    throw Object.assign(new Error("组织还没有配置 DeepSeek API Key"), { statusCode: 503 });
  }
  return decryptSecret(row.encrypted_key, config.masterKey);
}

export async function getPrice(db: Db, model: string): Promise<AiPrice> {
  const result = await db.query("SELECT * FROM ai_prices WHERE model = $1", [model]);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return {
    model,
    inputPerMillion: Number(row?.input_per_million_cny ?? 0),
    outputPerMillion: Number(row?.output_per_million_cny ?? 0),
    ocrPerPage: Number(row?.ocr_per_page_cny ?? 0),
    asrPerSecond: Number(row?.asr_per_second_cny ?? 0),
  };
}

function currentYearMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

async function ensurePeriod(client: import("pg").PoolClient, orgId: string): Promise<{ id: string; budget: number; spent: number }> {
  const yearMonth = currentYearMonth();
  const existing = await client.query(
    "SELECT id, budget_cny, spent_cny FROM quota_periods WHERE org_id = $1 AND year_month = $2 FOR UPDATE",
    [orgId, yearMonth],
  );
  if (existing.rows[0]) {
    return {
      id: String(existing.rows[0].id),
      budget: Number(existing.rows[0].budget_cny),
      spent: Number(existing.rows[0].spent_cny),
    };
  }
  const org = await client.query("SELECT monthly_budget_cny FROM organizations WHERE id = $1", [orgId]);
  const budget = Number(org.rows[0]?.monthly_budget_cny ?? 0);
  const id = randomUUID();
  await client.query(
    `INSERT INTO quota_periods (id, org_id, year_month, budget_cny, spent_cny, status)
     VALUES ($1, $2, $3, $4, 0, 'active')`,
    [id, orgId, yearMonth, budget],
  );
  return { id, budget, spent: 0 };
}

export async function assertBudget(db: Db, orgId: string): Promise<{ budget: number; spent: number }> {
  const client = await db.connect();
  try {
    const period = await ensurePeriod(client, orgId);
    if (period.budget > 0 && period.spent >= period.budget) {
      throw Object.assign(new Error("组织本月 AI 预算已用完"), { statusCode: 429 });
    }
    return { budget: period.budget, spent: period.spent };
  } finally {
    client.release();
  }
}

export async function recordUsage(db: Db, input: UsageInput): Promise<UsageResult> {
  const price = await getPrice(db, input.model);
  const inputTokens = Math.max(0, input.inputTokens ?? 0);
  const outputTokens = Math.max(0, input.outputTokens ?? 0);
  const ocrPages = Math.max(0, input.ocrPages ?? 0);
  const asrSeconds = Math.max(0, input.asrSeconds ?? 0);
  const estimated =
    (inputTokens / 1_000_000) * price.inputPerMillion +
    (outputTokens / 1_000_000) * price.outputPerMillion +
    ocrPages * price.ocrPerPage +
    asrSeconds * price.asrPerSecond;

  return withTransaction(db, async (client) => {
    const period = await ensurePeriod(client, input.orgId);
    const id = randomUUID();
    await client.query(
      `INSERT INTO usage_events
       (id, org_id, member_id, request_id, kind, model, input_tokens, output_tokens,
        ocr_pages, asr_seconds, estimated_cost_cny, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id,
        input.orgId,
        input.memberId,
        input.requestId,
        input.kind,
        input.model,
        inputTokens,
        outputTokens,
        ocrPages,
        asrSeconds,
        estimated,
        input.status ?? "success",
      ],
    );
    const spent = period.spent + estimated;
    await client.query("UPDATE quota_periods SET spent_cny = $1 WHERE id = $2", [spent, period.id]);
    return { estimatedCostCny: estimated, budgetCny: period.budget, spentCny: spent };
  });
}

export async function getMyUsage(db: Db, orgId: string, memberId: string): Promise<{
  month: string;
  totalCostCny: number;
  totalTokens: number;
  events: number;
}> {
  const result = await db.query(
    `SELECT coalesce(sum(estimated_cost_cny),0) AS cost,
            coalesce(sum(input_tokens + output_tokens),0) AS tokens,
            count(*)::int AS events
     FROM usage_events
     WHERE org_id = $1 AND member_id = $2 AND created_at >= date_trunc('month', now())`,
    [orgId, memberId],
  );
  const row = result.rows[0] as Record<string, unknown>;
  return {
    month: currentYearMonth(),
    totalCostCny: Number(row?.cost ?? 0),
    totalTokens: Number(row?.tokens ?? 0),
    events: Number(row?.events ?? 0),
  };
}
