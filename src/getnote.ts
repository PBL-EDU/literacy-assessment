/**
 * 得到大脑（Get笔记）OpenAPI 客户端。
 * 只读：列出录音笔记、读详情/转写、下载音频。
 * 官方文档：https://www.biji.com/openapi
 */
import { requestUrl, type RequestUrlResponse } from "obsidian";
import type { AssessmentSettings } from "./types";

export const GETNOTE_AUDIO_TYPES = new Set([
  "class_audio",
  "recorder_audio",
  "recorder_flash_audio",
  "audio",
  "local_audio",
  "meeting",
  "internal_record",
]);

export interface GetnoteNoteItem {
  /** 统一为字符串；API 的 note_id 是精确值，id 数值可能超过 JS 安全整数 */
  id: string;
  note_id?: string;
  title: string;
  note_type: string;
  source: string;
  created_at: string;
  updated_at: string;
  content?: string;
}

export interface GetnoteAttachment {
  type: string;
  url: string;
  title?: string;
  size?: number;
  duration?: number;
}

export interface GetnoteNoteDetail extends GetnoteNoteItem {
  audio?: {
    original?: string;
    play_url?: string;
    duration?: number;
  };
  attachments?: GetnoteAttachment[];
}

export class GetnoteError extends Error {
  status?: number;
  reason?: string;

  constructor(message: string, status?: number, reason?: string) {
    super(message);
    this.name = "GetnoteError";
    this.status = status;
    this.reason = reason;
  }
}

function baseOf(settings: AssessmentSettings): string {
  const raw = (settings.getnoteApiBase || "").trim().replace(/\/+$/, "");
  if (!raw) return "https://openapi.biji.com/open/api/v1";
  if (raw.endsWith("/open/api/v1")) return raw;
  if (raw.endsWith("/open")) return `${raw}/api/v1`;
  return `${raw}/open/api/v1`;
}

function assertCredentials(settings: AssessmentSettings): void {
  if (!settings.getnoteApiKey.trim()) {
    throw new GetnoteError("还没有配置得到大脑 API Key：设置 → 素养评估 → 得到大脑。");
  }
  if (!settings.getnoteClientId.trim()) {
    throw new GetnoteError("还没有配置得到大脑 Client ID：设置 → 素养评估 → 得到大脑。");
  }
}

function errorMessage(text: string, status: number): { message: string; reason?: string } {
  try {
    const data = JSON.parse(text) as {
      error?: { message?: string; reason?: string; code?: number | string };
      message?: string;
    };
    const message = data.error?.message ?? data.message ?? "";
    const reason = data.error?.reason;
    if (message || reason) {
      return { message: message || reason || "未知错误", reason };
    }
  } catch {
    /* ignore */
  }
  return { message: text.slice(0, 240) || `HTTP ${status}` };
}

interface Envelope<T> {
  success?: boolean;
  data?: T;
  error?: { message?: string; reason?: string; code?: number | string };
}

async function getJson<T>(
  settings: AssessmentSettings,
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<T> {
  assertCredentials(settings);
  const url = new URL(baseOf(settings) + path);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  let response: RequestUrlResponse;
  try {
    response = await requestUrl({
      url: url.toString(),
      method: "GET",
      headers: {
        Authorization: `Bearer ${settings.getnoteApiKey.trim()}`,
        "X-Client-ID": settings.getnoteClientId.trim(),
        Accept: "application/json",
      },
      throw: false,
    });
  } catch (error) {
    throw new GetnoteError(`连接得到大脑失败：${error instanceof Error ? error.message : String(error)}`);
  }

  const text = response.text ?? "";
  if (response.status === 401 || response.status === 403) {
    throw new GetnoteError(
      `得到大脑鉴权失败（HTTP ${response.status}）：检查 API Key / Client ID，并确认账号已开通得到大脑会员。`,
      response.status,
    );
  }
  if (response.status >= 400) {
    const parsed = errorMessage(text, response.status);
    throw new GetnoteError(`得到大脑接口报错（HTTP ${response.status}）：${parsed.message}`, response.status, parsed.reason);
  }

  let envelope: Envelope<T>;
  try {
    envelope = JSON.parse(text) as Envelope<T>;
  } catch {
    throw new GetnoteError("得到大脑返回的不是 JSON，请检查 API 地址。");
  }
  if (envelope.success === false) {
    const message = envelope.error?.message ?? envelope.error?.reason ?? "得到大脑返回失败";
    throw new GetnoteError(`得到大脑接口报错：${message}`, response.status, envelope.error?.reason);
  }
  if (envelope.data === undefined) {
    throw new GetnoteError("得到大脑返回缺少 data 字段。");
  }
  return envelope.data;
}

export interface GetnoteListOptions {
  createdFrom: string;
  createdTo: string;
  pageSize?: number;
  source?: "all" | "getseed" | "vendor_moan" | "dedao";
}

export async function listGetnoteNotes(
  settings: AssessmentSettings,
  options: GetnoteListOptions,
): Promise<GetnoteNoteItem[]> {
  const notes: GetnoteNoteItem[] = [];
  const source = options.source ?? settings.getnoteSource;
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const data = await getJson<{
      notes?: GetnoteNoteItem[];
      pagination?: { has_more?: boolean; next_cursor?: string | null };
      has_more?: boolean;
      cursor?: string;
      next_cursor?: string;
    }>(settings, "/resource/note/list", {
      created_from: options.createdFrom,
      created_to: options.createdTo,
      page_size: options.pageSize ?? 50,
      cursor,
      source: source && source !== "all" ? source : undefined,
    });
    if (Array.isArray(data.notes)) {
      notes.push(
        ...data.notes.map((note) => ({
          ...note,
          id: String(note.note_id ?? note.id),
        })),
      );
    }
    const hasMore = data.pagination?.has_more ?? data.has_more ?? false;
    cursor = data.pagination?.next_cursor ?? data.cursor ?? data.next_cursor ?? undefined;
    if (!hasMore || !cursor) break;
  }
  return notes;
}

export async function getGetnoteNote(
  settings: AssessmentSettings,
  noteId: string,
): Promise<GetnoteNoteDetail> {
  const data = await getJson<{ note?: GetnoteNoteDetail }>(settings, "/resource/note/detail", { id: noteId });
  if (!data.note) throw new GetnoteError("得到大脑没有返回该笔记详情。");
  return {
    ...data.note,
    id: String(data.note.note_id ?? data.note.id),
  };
}

export async function downloadGetnoteBinary(url: string): Promise<ArrayBuffer> {
  let response: RequestUrlResponse;
  try {
    response = await requestUrl({ url, method: "GET", throw: false });
  } catch (error) {
    throw new GetnoteError(`下载得到录音失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (response.status >= 400) {
    throw new GetnoteError(`下载得到录音失败（HTTP ${response.status}）。`);
  }
  if (!response.arrayBuffer) {
    throw new GetnoteError("得到录音下载没有返回二进制内容。");
  }
  return response.arrayBuffer;
}

export async function testGetnoteConnection(settings: AssessmentSettings): Promise<number> {
  const now = new Date();
  const from = new Date(now.getTime() - 24 * 3600_000);
  const notes = await listGetnoteNotes(settings, {
    createdFrom: from.toISOString(),
    createdTo: now.toISOString(),
    pageSize: 1,
    source: settings.getnoteSource,
  });
  return notes.length;
}
