/**
 * 语音/视频转写。
 * - DeepSeek 官方：POST /v1/tools/asr，短音频（WAV/Ogg，≤8 MB，≤120 秒）。
 * - OpenAI 兼容：POST /audio/transcriptions，支持更常见的音频/视频格式。
 * 桌面端使用 Node http/https，避开浏览器 CORS 与 requestUrl 的 body 限制。
 */
import { URL } from "url";
import type { AssessmentSettings, TranscriptResult, TranscriptSegment } from "./types";
import { mimeForFile } from "./core";
import { buildMultipart, errorText, postBuffer, type HttpResponse } from "./http";

const MAX_ASR_BYTES = 100 * 1024 * 1024;
const OPENAI_MAX_BYTES = 25 * 1024 * 1024;
const DEEPSEEK_MAX_BYTES = 8 * 1024 * 1024;
const DEEPSEEK_MAX_SECONDS = 120;

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

export function deepseekAsrEndpoint(settings: AssessmentSettings): string {
  const base = (settings.asrBaseUrl || "https://api.deepseek.com/v1").trim().replace(/\/+$/, "");
  if (/\/tools\/asr$/.test(base)) return base;
  return `${base}/tools/asr`;
}

function isDeepSeekAsrFile(fileName: string): boolean {
  return /\.(wav|ogg|opus)$/i.test(fileName);
}

/** 读取 WAV 头里的时长；解析不了返回 undefined，让服务端判断。 */
export function wavDurationSeconds(buffer: Buffer): number | undefined {
  if (buffer.length < 44) return undefined;
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") return undefined;
  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === "fmt " && offset + 20 <= buffer.length) {
      byteRate = buffer.readUInt32LE(offset + 16);
    } else if (chunkId === "data") {
      dataSize = Math.min(chunkSize, buffer.length - offset - 8);
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  if (!byteRate || !dataSize) return undefined;
  return dataSize / byteRate;
}

function parseOpenAiResult(body: Buffer, model: string): TranscriptResult {
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

export function parseDeepSeekAsrResult(body: Buffer): TranscriptResult {
  let data: unknown;
  try {
    data = JSON.parse(body.toString("utf8").trim());
  } catch {
    throw new AsrError("DeepSeek 转写返回的不是 JSON，请检查接口地址。");
  }
  const record = data as { error?: { message?: string }; text?: unknown; duration_ms?: unknown };
  if (record.error?.message) throw new AsrError(`DeepSeek 转写失败：${record.error.message}`);
  const text = typeof record.text === "string" ? record.text.trim() : "";
  if (!text) throw new AsrError("DeepSeek 转写返回了空文本，可能是音频格式不支持或文件损坏。");
  const duration = Number(record.duration_ms);
  return {
    text,
    segments: [],
    duration: Number.isFinite(duration) && duration > 0 ? duration / 1000 : undefined,
    model: "deepseek-asr",
  };
}

async function openAiAttempt(
  settings: AssessmentSettings,
  fileBuffer: Buffer,
  fileName: string,
  responseFormat: string,
): Promise<HttpResponse> {
  const size = fileBuffer.length;
  if (size > MAX_ASR_BYTES) {
    throw new AsrError(`文件超过 ${MAX_ASR_BYTES / 1024 / 1024} MB，建议先在本地压缩或裁切后再转写。`);
  }
  if (isOpenAiHost(settings.asrBaseUrl) && size > OPENAI_MAX_BYTES) {
    const mb = (size / 1024 / 1024).toFixed(1);
    throw new AsrError(
      `OpenAI 转写接口单文件上限 25 MB，当前文件约 ${mb} MB。长课堂录音优先用「得到录音卡/录音台」录制，等待得到转写后，在侧栏点「同步得到」；也可以先压缩/切分，或把现成转写文字放进 素材/ 或 观察/。`,
    );
  }
  if (!fileBuffer.length) throw new AsrError("素材文件是空的。");
  if (!settings.asrApiKey) throw new AsrError("还没有配置转写 API Key：设置 → 素养评估 → 语音转写");
  const boundary = `----literacy${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const body = buildMultipart(boundary, fileName, mimeForFile(fileName), fileBuffer, {
    model: settings.asrModel,
    language: settings.asrLanguage,
    response_format: responseFormat,
  });
  return postBuffer(
    asrEndpoint(settings),
    {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      Authorization: `Bearer ${settings.asrApiKey}`,
      Accept: "application/json",
    },
    body,
    Math.max(settings.aiTimeoutMs, 180_000),
  );
}

async function transcribeWithOpenAi(
  settings: AssessmentSettings,
  buffer: Buffer,
  fileName: string,
): Promise<TranscriptResult> {
  let response = await openAiAttempt(settings, buffer, fileName, "verbose_json");
  if (response.status >= 400 && response.status < 500) {
    const message = errorText(response.body, response.status);
    // 一些网关只支持 json，不支持 verbose_json
    if (/verbose|response_format|unsupported|invalid/i.test(message)) {
      response = await openAiAttempt(settings, buffer, fileName, "json");
    }
  }
  if (response.status === 401 || response.status === 403) {
    throw new AsrError(`转写 API Key 无效或没有权限（HTTP ${response.status}）：${errorText(response.body, response.status)}`);
  }
  if (response.status >= 400) {
    throw new AsrError(`语音转写失败（HTTP ${response.status}）：${errorText(response.body, response.status)}`);
  }
  return parseOpenAiResult(response.body, settings.asrModel);
}

async function transcribeWithDeepSeek(
  settings: AssessmentSettings,
  buffer: Buffer,
  fileName: string,
): Promise<TranscriptResult> {
  if (!isDeepSeekAsrFile(fileName)) {
    throw new AsrError(
      `DeepSeek 官方转写只支持 WAV/Ogg/Opus，当前文件是「${fileName}」。` +
        "长课堂录音请优先用「得到录音卡/录音台」录制，等待得到转写后点侧栏「同步得到」；" +
        "短音频可以转成 WAV，或改用「OpenAI 兼容 /audio/transcriptions」。",
    );
  }
  if (buffer.length > DEEPSEEK_MAX_BYTES) {
    throw new AsrError("DeepSeek 官方转写单文件上限 8 MB；长课堂录音请用得到录音卡/录音台录制，再用「同步得到」；短音频可切分后重试。");
  }
  const duration = wavDurationSeconds(buffer);
  if (duration && duration > DEEPSEEK_MAX_SECONDS) {
    throw new AsrError(
      `DeepSeek 官方转写最长 120 秒，当前 WAV 约 ${Math.round(duration)} 秒。长课堂录音请用得到录音卡/录音台录制，再用「同步得到」；短音频可切分后重试。`,
    );
  }
  const key = settings.asrApiKey || settings.aiApiKey;
  if (!key) throw new AsrError("还没有配置 DeepSeek 转写 API Key：设置 → 素养评估 → AI 服务/语音转写");
  const boundary = `----literacy${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const body = buildMultipart(boundary, fileName, mimeForFile(fileName), buffer, {});
  const response = await postBuffer(
    deepseekAsrEndpoint(settings),
    {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
    body,
    Math.max(settings.aiTimeoutMs, 180_000),
  );
  if (response.status >= 400) {
    throw new AsrError(`DeepSeek 转写失败（HTTP ${response.status}）：${errorText(response.body, response.status)}`);
  }
  return parseDeepSeekAsrResult(response.body);
}

export async function transcribeFile(
  settings: AssessmentSettings,
  fileBuffer: ArrayBuffer | Uint8Array,
  fileName: string,
): Promise<TranscriptResult> {
  if (!settings.asrEnabled) throw new AsrError("语音转写已在设置里关闭。");
  const buffer = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer as ArrayBuffer);
  if (!buffer.length) throw new AsrError("素材文件是空的。");
  let org: typeof import("./org") | null = null;
  try {
    org = await import("./org");
  } catch {
    org = null;
  }
  if (org?.orgActive()) {
    if (!isDeepSeekAsrFile(fileName)) {
      throw new AsrError("组织统一结算当前只支持 DeepSeek 官方 ASR（WAV/Ogg/Opus，≤8 MB，≤120 秒）；长课堂录音请用得到录音卡/录音台。");
    }
    if (buffer.length > DEEPSEEK_MAX_BYTES) {
      throw new AsrError("组织 ASR 单文件上限 8 MB；长课堂录音请用得到录音卡/录音台。");
    }
    const duration = wavDurationSeconds(buffer);
    if (duration && duration > DEEPSEEK_MAX_SECONDS) {
      throw new AsrError("组织 ASR 最长 120 秒；长课堂录音请用得到录音卡/录音台。");
    }
    try {
      const raw = await org.orgAsr(buffer, fileName, {});
      return parseDeepSeekAsrResult(Buffer.from(raw, "utf8"));
    } catch (error) {
      throw new AsrError(`组织 ASR 网关失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (org?.orgRequiresGateway()) {
    throw new AsrError("组织会话不可用；为避免误用个人 Key，请先重试组织连接或退出组织。");
  }
  if (settings.asrProvider === "deepseek") {
    return transcribeWithDeepSeek(settings, buffer, fileName);
  }
  return transcribeWithOpenAi(settings, buffer, fileName);
}
