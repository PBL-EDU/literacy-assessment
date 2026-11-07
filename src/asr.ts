/**
 * 语音/视频转写：OpenAI 兼容 /audio/transcriptions，multipart 直传。
 * 桌面端使用 Node http/https，避开浏览器 CORS 与 requestUrl 的 body 限制。
 */
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import { URL } from "url";
import type { AssessmentSettings, TranscriptResult, TranscriptSegment } from "./types";
import { mimeForFile } from "./core";

const MAX_ASR_BYTES = 100 * 1024 * 1024;
const OPENAI_MAX_BYTES = 25 * 1024 * 1024;

function isOpenAiHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "api.openai.com" || host.endsWith(".openai.com");
  } catch {
    return false;
  }
}

export class AsrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AsrError";
  }
}

export function asrEndpoint(settings: AssessmentSettings): string {
  const base = (settings.asrBaseUrl || "").trim().replace(/\/+$/, "");
  if (!base) throw new AsrError("还没有配置语音转写服务地址：设置 → 素养评估 → 语音转写");
  if (/\/audio\/transcriptions$/.test(base)) return base;
  return `${base}/audio/transcriptions`;
}

function fieldPart(boundary: string, name: string, value: string): Buffer {
  return Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    "utf8",
  );
}

function asciiFileName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const ext = dot >= 0 ? fileName.slice(dot + 1).replace(/[^A-Za-z0-9]/g, "") : "bin";
  const base = (dot >= 0 ? fileName.slice(0, dot) : fileName)
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\\r\n]/g, "_")
    .slice(0, 80) || "audio";
  return `${base}.${ext || "bin"}`;
}

function buildMultipart(
  boundary: string,
  fileName: string,
  mime: string,
  fileBuffer: Buffer,
  fields: Record<string, string>,
): Buffer {
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    if (value) parts.push(fieldPart(boundary, name, value));
  }
  const safeName = asciiFileName(fileName);
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: ${mime}\r\n\r\n`,
      "utf8",
    ),
  );
  parts.push(fileBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"));
  return Buffer.concat(parts);
}

interface HttpResponse {
  status: number;
  body: Buffer;
}

function postBuffer(urlString: string, headers: Record<string, string>, body: Buffer, timeoutMs: number): Promise<HttpResponse> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return Promise.reject(new AsrError(`语音转写地址不合法：${urlString}`));
  }
  const lib = url.protocol === "http:" ? http : https;
  return new Promise<HttpResponse>((resolve, reject) => {
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "http:" ? 80 : 443),
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: { ...headers, "Content-Length": String(body.length) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
        res.on("error", (error: Error) => reject(new AsrError(`读取转写响应失败：${error.message}`)));
      },
    );
    req.setTimeout(Math.max(10_000, timeoutMs), () => {
      req.destroy(new AsrError(`语音转写超时（${Math.round(timeoutMs / 1000)} 秒）`));
    });
    req.on("error", (error: Error) => reject(new AsrError(`语音转写请求失败：${error.message}`)));
    req.write(body);
    req.end();
  });
}

function errorOf(body: Buffer, status: number): string {
  const text = body.toString("utf8");
  try {
    const data = JSON.parse(text) as { error?: { message?: string }; message?: string };
    return data?.error?.message ?? data?.message ?? text.slice(0, 240);
  } catch {
    return text.slice(0, 240) || `HTTP ${status}`;
  }
}

function parseResult(body: Buffer, model: string): TranscriptResult {
  let data: unknown;
  try {
    data = JSON.parse(body.toString("utf8"));
  } catch {
    throw new AsrError("转写服务返回的不是 JSON，请检查服务地址与模型。");
  }
  const record = data as {
    text?: unknown;
    language?: unknown;
    duration?: unknown;
    segments?: Array<{ start?: unknown; end?: unknown; text?: unknown }>;
  };
  const segments: TranscriptSegment[] = Array.isArray(record.segments)
    ? record.segments
        .map((s) => ({
          start: Number(s.start) || 0,
          end: Number(s.end) || 0,
          text: typeof s.text === "string" ? s.text.trim() : "",
        }))
        .filter((s) => s.text)
    : [];
  const text = (typeof record.text === "string" ? record.text : segments.map((s) => s.text).join("")).trim();
  if (!text) throw new AsrError("转写服务返回了空文本，可能是音频格式不支持或文件损坏。");
  return {
    text,
    segments,
    language: typeof record.language === "string" ? record.language : undefined,
    duration: Number(record.duration) || undefined,
    model,
  };
}

async function attempt(
  settings: AssessmentSettings,
  absolutePath: string,
  fileName: string,
  responseFormat: string,
): Promise<HttpResponse> {
  const stat = await fs.promises.stat(absolutePath);
  if (stat.size > MAX_ASR_BYTES) {
    throw new AsrError(`文件超过 ${MAX_ASR_BYTES / 1024 / 1024} MB，建议先在本地压缩或裁切后再转写。`);
  }
  if (isOpenAiHost(settings.asrBaseUrl) && stat.size > OPENAI_MAX_BYTES) {
    const size = (stat.size / 1024 / 1024).toFixed(1);
    throw new AsrError(
      `OpenAI 转写接口单文件上限 25 MB，当前文件约 ${size} MB。请先压缩/切分；或把「得到大脑」等现成转写文字放进 素材/ 或 观察/，直接用文字生成报告。`,
    );
  }
  const fileBuffer = await fs.promises.readFile(absolutePath);
  if (!fileBuffer.length) throw new AsrError("素材文件是空的。");
  const boundary = `----literacy${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const body = buildMultipart(boundary, fileName, mimeForFile(fileName), fileBuffer, {
    model: settings.asrModel,
    language: settings.asrLanguage,
    response_format: responseFormat,
  });
  const headers: Record<string, string> = {
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
    Authorization: `Bearer ${settings.asrApiKey}`,
    Accept: "application/json",
  };
  return postBuffer(asrEndpoint(settings), headers, body, Math.max(settings.aiTimeoutMs, 180_000));
}

export async function transcribeFile(
  settings: AssessmentSettings,
  absolutePath: string,
  fileName: string,
): Promise<TranscriptResult> {
  if (!settings.asrEnabled) throw new AsrError("语音转写已在设置里关闭。");
  if (!settings.asrApiKey) throw new AsrError("还没有配置语音转写 API Key：设置 → 素养评估 → 语音转写");

  let response = await attempt(settings, absolutePath, fileName, "verbose_json");
  if (response.status >= 400 && response.status < 500) {
    const message = errorOf(response.body, response.status);
    // 一些网关只支持 json，不支持 verbose_json
    if (/verbose|response_format|unsupported|invalid/i.test(message)) {
      response = await attempt(settings, absolutePath, fileName, "json");
    }
  }
  if (response.status === 401 || response.status === 403) {
    throw new AsrError(`转写 API Key 无效或没有权限（HTTP ${response.status}）：${errorOf(response.body, response.status)}`);
  }
  if (response.status >= 400) {
    throw new AsrError(`语音转写失败（HTTP ${response.status}）：${errorOf(response.body, response.status)}`);
  }
  return parseResult(response.body, settings.asrModel);
}
