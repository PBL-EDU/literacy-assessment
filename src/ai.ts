/**
 * AI 对话层：OpenAI 兼容 chat/completions。
 * 走 Obsidian 的 requestUrl，绕过 CORS；视觉消息支持 image_url。
 */
import { requestUrl } from "obsidian";
import type { AssessmentSettings, ChatMessage } from "./types";
import { extractJson } from "./core";

export class AiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "AiError";
    this.status = status;
  }
}

export interface ChatContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface ChatMessageLike {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
}

export interface ChatOptions {
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  model?: string;
}

function baseOf(settings: AssessmentSettings): string {
  return (settings.aiBaseUrl || "").trim().replace(/\/+$/, "");
}

export function chatEndpoint(settings: AssessmentSettings): string {
  const base = baseOf(settings);
  if (!base) throw new AiError("还没有配置 AI 服务地址：设置 → 素养评估 → AI 服务");
  if (/\/chat\/completions$/.test(base)) return base;
  return `${base}/chat/completions`;
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  const timeoutMs = Math.max(1000, ms);
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new AiError(`${what}超时（${Math.round(timeoutMs / 1000)} 秒）`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) window.clearTimeout(timer);
  });
}

function errorMessageOf(text: string, status: number): string {
  try {
    const data = JSON.parse(text) as { error?: { message?: string }; message?: string };
    const msg = data?.error?.message ?? data?.message;
    if (msg) return msg;
  } catch {
    /* ignore */
  }
  return text.slice(0, 240) || `HTTP ${status}`;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === "object") {
          const record = part as { text?: unknown };
          return typeof record.text === "string" ? record.text : "";
        }
        return "";
      })
      .join("");
  }
  return "";
}

export async function chat(
  settings: AssessmentSettings,
  messages: ChatMessageLike[],
  options: ChatOptions = {},
): Promise<string> {
  if (!settings.aiApiKey) {
    throw new AiError("还没有配置 AI API Key：设置 → 素养评估 → AI 服务");
  }
  const model = options.model ?? settings.aiModel;
  if (!model) throw new AiError("还没有配置模型名称：设置 → 素养评估 → AI 服务");

  const payload: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature ?? settings.aiTemperature,
    max_tokens: options.maxTokens ?? settings.aiMaxTokens,
    stream: false,
  };
  if (options.json) payload.response_format = { type: "json_object" };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${settings.aiApiKey}`,
  };

  const send = async (body: Record<string, unknown>) => {
    try {
      return await requestUrl({
        url: chatEndpoint(settings),
        method: "POST",
        headers,
        body: JSON.stringify(body),
        throw: false,
      });
    } catch (e) {
      throw new AiError(`网络请求失败：${(e as Error).message}。检查服务地址、代理或网络。`);
    }
  };

  let response = await withTimeout(send(payload), options.timeoutMs ?? settings.aiTimeoutMs, "AI 请求");

  // 部分网关不支持 response_format，降级重试一次
  if (response.status >= 400 && response.status < 500 && payload.response_format) {
    const firstError = errorMessageOf(response.text ?? "", response.status);
    if (/response_format|json_object|unsupported|invalid request/i.test(firstError)) {
      delete payload.response_format;
      response = await withTimeout(send(payload), options.timeoutMs ?? settings.aiTimeoutMs, "AI 请求");
    }
  }

  const text = response.text ?? "";
  if (response.status === 401 || response.status === 403) {
    throw new AiError(`API Key 无效或没有权限（HTTP ${response.status}）：${errorMessageOf(text, response.status)}`, response.status);
  }
  if (response.status === 429) {
    throw new AiError("请求过于频繁或额度不足（HTTP 429），稍后再试。", 429);
  }
  if (response.status === 404) {
    throw new AiError(`接口不存在（HTTP 404）：${chatEndpoint(settings)}。检查地址是否少了 /v1，或模型名是否正确。`, 404);
  }
  if (response.status >= 400) {
    throw new AiError(`AI 服务报错（HTTP ${response.status}）：${errorMessageOf(text, response.status)}`, response.status);
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AiError(`AI 返回的不是 JSON（HTTP ${response.status}）：${text.slice(0, 160)}`);
  }
  const choices = (data as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const output = contentText(choices?.[0]?.message?.content);
  if (!output.trim()) throw new AiError("AI 返回了空内容，请检查模型名称是否正确。");
  return output;
}

export async function chatJson(
  settings: AssessmentSettings,
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<unknown> {
  const raw = await chat(settings, messages, { ...options, json: true });
  let parsed = extractJson(raw);
  if (parsed !== null) return parsed;

  const repair: ChatMessage[] = [
    ...messages,
    { role: "assistant", content: raw.slice(0, 4000) },
    {
      role: "user",
      content: "上面的输出不是合法 JSON。请严格只输出一个 JSON 对象，不要 Markdown 代码围栏，不要任何解释。",
    },
  ];
  const second = await chat(settings, repair, { ...options, json: true });
  parsed = extractJson(second);
  if (parsed === null) {
    throw new AiError("AI 连续两次返回的内容都不是合法 JSON，请换一个模型或降低上下文长度后重试。");
  }
  return parsed;
}

export async function testConnection(settings: AssessmentSettings): Promise<string> {
  return chat(
    settings,
    [
      { role: "system", content: "你是连接测试助手。" },
      { role: "user", content: "请只回复四个字：连接成功" },
    ],
    { maxTokens: 20, temperature: 0, timeoutMs: 30_000 },
  );
}
