/**
 * 组织版客户端：设备令牌、个人/组织模式判断、组织 AI 网关。
 * 组织 Key 永远不进入插件；本模块只保存 refresh token 与短期 access token。
 */
import { requestUrl } from "obsidian";
import type { AssessmentSettings } from "./types";
import { buildMultipart, errorText, postBuffer } from "./http";
import { mimeForFile } from "./core";
import type { ChatMessage } from "./types";

export type OrgStatus = "none" | "active" | "offline" | "invalid";

interface OrgState {
  status: OrgStatus;
  orgName: string;
  memberName: string;
  accessToken: string;
  accessExpiresAt: number;
  error: string;
}

interface AuthBundle {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  org: { id: string; name: string; slug: string };
  member: { id: string; displayName: string; role: string };
}

interface ChatOptions {
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  model?: string;
}

const state: OrgState = {
  status: "none",
  orgName: "",
  memberName: "",
  accessToken: "",
  accessExpiresAt: 0,
  error: "",
};

let currentSettings: AssessmentSettings | null = null;
let saveSettings: (() => Promise<void>) | null = null;

function baseUrl(settings: AssessmentSettings): string {
  return (settings.orgServerUrl || "https://plan.dreamook.com").replace(/\/+$/, "");
}

export function configureOrgClient(
  settings: AssessmentSettings,
  save: () => Promise<void>,
): void {
  currentSettings = settings;
  saveSettings = save;
}

export function orgStatus(): OrgState {
  return { ...state };
}

export function orgActive(): boolean {
  return state.status === "active" || state.status === "offline";
}

export function orgRequiresGateway(): boolean {
  return Boolean(currentSettings?.orgRefreshToken);
}

function setActive(bundle: AuthBundle, settings: AssessmentSettings): void {
  state.status = "active";
  state.orgName = bundle.org.name;
  state.memberName = bundle.member.displayName;
  state.accessToken = bundle.accessToken;
  state.accessExpiresAt = Date.now() + Math.max(30, bundle.expiresIn - 30) * 1000;
  state.error = "";
  settings.orgRefreshToken = bundle.refreshToken;
  settings.orgName = bundle.org.name;
  settings.orgMemberName = bundle.member.displayName;
}

function clearSession(settings: AssessmentSettings, invalid: boolean): void {
  state.status = invalid ? "invalid" : "none";
  state.orgName = "";
  state.memberName = "";
  state.accessToken = "";
  state.accessExpiresAt = 0;
  state.error = invalid ? "组织会话已失效，请重新加入" : "";
  settings.orgRefreshToken = "";
  settings.orgName = "";
  settings.orgMemberName = "";
}

export async function initOrgSession(settings: AssessmentSettings): Promise<void> {
  currentSettings = settings;
  state.orgName = settings.orgName;
  state.memberName = settings.orgMemberName;
  if (!settings.orgRefreshToken) {
    state.status = "none";
    return;
  }
  try {
    const bundle = await refresh(settings);
    setActive(bundle, settings);
  } catch (error) {
    // 网络不可用时保留组织身份，避免静默切到个人 Key。
    state.status = "offline";
    state.error = error instanceof Error ? error.message : "组织服务不可用";
    state.orgName = settings.orgName;
    state.memberName = settings.orgMemberName;
  }
}

export async function joinOrganization(
  settings: AssessmentSettings,
  input: { serverUrl?: string; code: string; displayName: string; deviceName?: string },
): Promise<void> {
  currentSettings = settings;
  if (input.serverUrl) settings.orgServerUrl = input.serverUrl.trim().replace(/\/+$/, "");
  const bundle = await requestAuth(baseUrl(settings), "/api/auth/redeem-invite", {
    code: input.code.trim().toUpperCase(),
    displayName: input.displayName.trim(),
    deviceName: input.deviceName?.trim() || "Obsidian",
  });
  setActive(bundle, settings);
  await saveSettings?.();
}

export async function refreshOrgSession(): Promise<void> {
  if (!currentSettings?.orgRefreshToken) throw new Error("尚未加入组织");
  try {
    const bundle = await refresh(currentSettings);
    setActive(bundle, currentSettings);
    await saveSettings?.();
  } catch (error) {
    if (error instanceof OrgHttpError && error.status === 401) {
      clearSession(currentSettings, true);
      await saveSettings?.();
    } else {
      state.status = "offline";
      state.error = error instanceof Error ? error.message : String(error);
    }
    throw error;
  }
}

export async function leaveOrganization(): Promise<void> {
  if (currentSettings?.orgRefreshToken) {
    try {
      await authorizedRequest("/api/auth/logout", { method: "POST" });
    } catch {
      /* 本地清理优先 */
    }
  }
  if (currentSettings) {
    clearSession(currentSettings, false);
    await saveSettings?.();
  }
}

async function refresh(settings: AssessmentSettings): Promise<AuthBundle> {
  const response = await requestUrl({
    url: `${baseUrl(settings)}/api/auth/refresh`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: settings.orgRefreshToken }),
    throw: false,
  });
  if (response.status === 401) throw new OrgHttpError(401, "组织会话已失效");
  if (response.status >= 400) throw new OrgHttpError(response.status, errorText(Buffer.from(response.text ?? ""), response.status));
  return JSON.parse(response.text) as AuthBundle;
}

function requestAuth(url: string, path: string, body: unknown): Promise<AuthBundle> {
  return requestUrl({
    url: `${url}${path}`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    throw: false,
  }).then((response) => {
    if (response.status >= 400) {
      throw new OrgHttpError(response.status, errorText(Buffer.from(response.text ?? ""), response.status));
    }
    return JSON.parse(response.text) as AuthBundle;
  });
}

async function authorizedRequest(
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; text: string }> {
  const settings = currentSettings;
  if (!settings) throw new Error("组织客户端未初始化");
  if (!state.accessToken && settings.orgRefreshToken) await refreshOrgSession();
  if (!state.accessToken) throw new Error("尚未加入组织");
  const send = async (token: string) => {
    const response = await requestUrl({
      url: `${baseUrl(settings)}${path}`,
      method: init.method ?? "GET",
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
      body: init.body,
      throw: false,
    });
    return { status: response.status, text: response.text ?? "" };
  };
  let result = await send(state.accessToken);
  if (result.status === 401) {
    await refreshOrgSession();
    result = await send(state.accessToken);
  }
  return result;
}

export async function orgGet(path: string): Promise<unknown> {
  const response = await authorizedRequest(path);
  if (response.status >= 400) throw new OrgHttpError(response.status, response.text);
  return JSON.parse(response.text);
}

export async function orgChat(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<string> {
  const settings = currentSettings;
  if (!settings) throw new Error("组织客户端未初始化");
  const model = options.model ?? settings.aiModel;
  const payload: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature ?? settings.aiTemperature,
    max_tokens: options.maxTokens ?? settings.aiMaxTokens,
    stream: false,
  };
  if (options.json) payload.response_format = { type: "json_object" };
  const response = await authorizedRequest("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = response.text;
  if (response.status === 401 || response.status === 403) {
    throw new OrgHttpError(response.status, `组织会话失效：${errorText(Buffer.from(text), response.status)}`);
  }
  if (response.status === 429) throw new OrgHttpError(429, "组织 AI 额度不足");
  if (response.status >= 400) throw new OrgHttpError(response.status, errorText(Buffer.from(text), response.status));
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new OrgHttpError(response.status, "组织网关返回的不是 JSON");
  }
  const content = (data as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new OrgHttpError(502, "组织网关返回了空内容");
  return content;
}

export async function orgOcr(
  fileBuffer: Buffer,
  fileName: string,
  purpose: string,
): Promise<string> {
  const settings = currentSettings;
  if (!settings) throw new Error("组织客户端未初始化");
  const boundary = `----literacyorg${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const body = buildMultipart(boundary, fileName, mimeForFile(fileName), fileBuffer, { purpose });
  const send = async () => {
    if (!state.accessToken) await refreshOrgSession();
    return postBuffer(
      `${baseUrl(settings)}/api/ai/ocr`,
      {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        Authorization: `Bearer ${state.accessToken}`,
        Accept: "application/json",
      },
      body,
      Math.max(settings.aiTimeoutMs, 180_000),
    );
  };
  let response = await send();
  if (response.status === 401) {
    await refreshOrgSession();
    response = await send();
  }
  const text = response.body.toString("utf8");
  if (response.status >= 400) throw new OrgHttpError(response.status, errorText(response.body, response.status));
  return text;
}

export async function orgAsr(
  fileBuffer: Buffer,
  fileName: string,
  fields: Record<string, string>,
): Promise<string> {
  const settings = currentSettings;
  if (!settings) throw new Error("组织客户端未初始化");
  const boundary = `----literacyorg${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const body = buildMultipart(boundary, fileName, mimeForFile(fileName), fileBuffer, fields);
  const send = async () => {
    if (!state.accessToken) await refreshOrgSession();
    return postBuffer(
      `${baseUrl(settings)}/api/ai/asr`,
      {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        Authorization: `Bearer ${state.accessToken}`,
        Accept: "application/json",
      },
      body,
      Math.max(settings.aiTimeoutMs, 180_000),
    );
  };
  let response = await send();
  if (response.status === 401) {
    await refreshOrgSession();
    response = await send();
  }
  const text = response.body.toString("utf8");
  if (response.status >= 400) throw new OrgHttpError(response.status, errorText(response.body, response.status));
  return text;
}

export async function orgFrameworks(): Promise<Array<{
  frameworkId: string;
  name: string;
  version: string;
  hash: string;
  markdown: string;
}>> {
  const data = (await orgGet("/api/frameworks")) as { frameworks?: Array<Record<string, unknown>> };
  return (data.frameworks ?? []).map((raw) => ({
    frameworkId: String(raw.frameworkId ?? ""),
    name: String(raw.name ?? ""),
    version: String(raw.version ?? ""),
    hash: String(raw.hash ?? ""),
    markdown: String(raw.markdown ?? ""),
  }));
}

export class OrgHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "OrgHttpError";
  }
}
