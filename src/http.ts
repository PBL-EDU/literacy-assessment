/**
 * 小型 HTTP / multipart 工具：只在桌面端 Node 环境使用，避免 Obsidian requestUrl 对
 * 二进制 body 和 multipart 的限制。语音转写与 OCR 共用。
 */
import * as http from "http";
import * as https from "https";
import { URL } from "url";

export interface HttpResponse {
  status: number;
  body: Buffer;
}

export class HttpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export function fieldPart(boundary: string, name: string, value: string): Buffer {
  return Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    "utf8",
  );
}

export function asciiFileName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const ext = dot >= 0 ? fileName.slice(dot + 1).replace(/[^A-Za-z0-9]/g, "") : "bin";
  const base = (dot >= 0 ? fileName.slice(0, dot) : fileName)
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\\r\n]/g, "_")
    .slice(0, 80) || "file";
  return `${base}.${ext || "bin"}`;
}

export function buildMultipart(
  boundary: string,
  fileName: string,
  mime: string,
  fileBuffer: Buffer,
  fields: Record<string, string> = {},
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

export function postBuffer(
  urlString: string,
  headers: Record<string, string>,
  body: Buffer,
  timeoutMs: number,
): Promise<HttpResponse> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return Promise.reject(new HttpError(`接口地址不合法：${urlString}`));
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
        res.on("error", (error: Error) => reject(new HttpError(`读取响应失败：${error.message}`)));
      },
    );
    req.setTimeout(Math.max(10_000, timeoutMs), () => {
      req.destroy(new HttpError(`请求超时（${Math.round(timeoutMs / 1000)} 秒）`));
    });
    req.on("error", (error: Error) => reject(new HttpError(`请求失败：${error.message}`)));
    req.write(body);
    req.end();
  });
}

export function errorText(body: Buffer, status: number): string {
  const text = body.toString("utf8");
  try {
    const data = JSON.parse(text) as { error?: { message?: string }; message?: string };
    return data?.error?.message ?? data?.message ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300) || `HTTP ${status}`;
  }
}
