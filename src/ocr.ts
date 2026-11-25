/**
 * DeepSeek 官方 OCR：POST /v1/tools/ocr。
 * 用于 PDF / Word / PowerPoint 学习单、扫描件和图片；与视觉模型分开计费。
 */
import { mimeForFile } from "./core";
import type { AssessmentSettings } from "./types";
import { buildMultipart, errorText, postBuffer } from "./http";

export const DEEPSEEK_OCR_BASE = "https://api.deepseek.com/v1";
const MAX_OCR_BYTES = 100 * 1024 * 1024;
const OCR_EXTS = new Set(["pdf", "doc", "docx", "ppt", "pptx", "png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"]);

export class OcrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OcrError";
  }
}

export function ocrEndpoint(settings: AssessmentSettings): string {
  const base = (settings.ocrBaseUrl || settings.aiBaseUrl || DEEPSEEK_OCR_BASE).trim().replace(/\/+$/, "");
  if (!base) throw new OcrError("还没有配置 OCR 服务地址：设置 → 素养评估 → OCR");
  if (/\/tools\/ocr$/.test(base)) return base;
  return `${base}/tools/ocr`;
}

export function canOcrFile(fileName: string): boolean {
  const dot = fileName.lastIndexOf(".");
  const ext = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
  return OCR_EXTS.has(ext);
}

/** 去掉 DeepSeek OCR 的引用/坐标标签，保留可读文本。 */
export function stripOcrMarkup(text: string): string {
  return text
    .replace(/<｜[^｜>]*｜>/g, "")
    .replace(/<\|[^|>]*\|>/g, "")
    .replace(/\[\[\s*\d+(?:\s*,\s*\d+){3}\s*\]\]/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

export interface OcrPage {
  index: number;
  text: string;
  finishReason?: string;
}

export interface OcrResult {
  text: string;
  pages: OcrPage[];
  pageCount: number;
  purpose: string;
  model: string;
}

export function parseOcrResponse(raw: string, purpose: string): OcrResult {
  let data: unknown;
  try {
    data = JSON.parse(raw.trim());
  } catch {
    throw new OcrError("OCR 服务返回的不是 JSON，请检查服务地址和账号权限。");
  }
  const record = data as {
    error?: { message?: string };
    page_count?: unknown;
    pages?: Array<{ index?: unknown; text?: unknown; finish_reason?: unknown }>;
    usage?: unknown;
  };
  if (record.error?.message) throw new OcrError(`OCR 失败：${record.error.message}`);
  const pages = Array.isArray(record.pages)
    ? record.pages.map((page, index) => ({
        index: Number(page.index) || index,
        text: stripOcrMarkup(typeof page.text === "string" ? page.text : ""),
        finishReason: typeof page.finish_reason === "string" ? page.finish_reason : undefined,
      }))
    : [];
  if (!pages.length) throw new OcrError("OCR 没有返回任何页面文本。");
  const text = pages
    .map((page) => {
      const marker = page.finishReason === "length" ? "（本页输出达到上限，可能不完整）" : "";
      return `## 第 ${page.index + 1} 页${marker}\n\n${page.text}`;
    })
    .join("\n\n");
  return {
    text,
    pages,
    pageCount: Number(record.page_count) || pages.length,
    purpose,
    model: "deepseek-ocr",
  };
}

export async function ocrFile(
  settings: AssessmentSettings,
  fileBuffer: ArrayBuffer | Uint8Array,
  fileName: string,
): Promise<OcrResult> {
  if (!settings.ocrEnabled) throw new OcrError("OCR 已在设置里关闭。");
  if (!canOcrFile(fileName)) {
    throw new OcrError(`DeepSeek OCR 不支持这种文件：${fileName}。支持 PDF、Word、PowerPoint 和常见图片。`);
  }
  if (!settings.ocrApiKey && !settings.aiApiKey) {
    throw new OcrError("还没有配置 DeepSeek API Key：设置 → 素养评估 → AI 服务。");
  }
  const buffer = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer as ArrayBuffer);
  if (!buffer.length) throw new OcrError("文件是空的。");
  if (buffer.length > MAX_OCR_BYTES) {
    throw new OcrError(`文件超过 100 MB，DeepSeek OCR 无法处理；请先压缩或拆分。`);
  }
  const boundary = `----literacyocr${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const purpose = settings.ocrPurpose;
  const body = buildMultipart(boundary, fileName, mimeForFile(fileName), buffer, { purpose });
  const key = settings.ocrApiKey || settings.aiApiKey;
  const response = await postBuffer(
    ocrEndpoint(settings),
    {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
    body,
    Math.max(settings.aiTimeoutMs, 180_000),
  );
  if (response.status >= 400) {
    throw new OcrError(`OCR 失败（HTTP ${response.status}）：${errorText(response.body, response.status)}`);
  }
  return parseOcrResponse(response.body.toString("utf8"), purpose);
}

export function renderOcrMarkdown(fileName: string, result: OcrResult): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push("type: ocr");
  lines.push(`source: 素材/${fileName}`);
  lines.push(`model: ${result.model}`);
  lines.push(`purpose: ${result.purpose}`);
  lines.push(`page_count: ${result.pageCount}`);
  lines.push(`generated_at: ${new Date().toISOString()}`);
  lines.push("---");
  lines.push("");
  lines.push(`# OCR：${fileName}`);
  lines.push("");
  lines.push("> 由 DeepSeek OCR 生成；扫描/排版本可能有误差，引用前请对照原件。");
  lines.push("");
  lines.push(result.text);
  lines.push("");
  return lines.join("\n");
}
