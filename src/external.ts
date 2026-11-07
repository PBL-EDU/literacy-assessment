/**
 * 对外版报告：化名 + 照片模糊。
 * 只在本地处理图片；报告正文中的真实姓名替换为 alias/同学A、B……
 */
import type { App } from "obsidian";
import { normalizePath } from "obsidian";
import type { AssessmentSettings } from "./types";
import { listStudentProfiles } from "./vault";
import { ensureFolder, writeBinary, writeText } from "./vault";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function getAliasMap(
  app: App,
  settings: AssessmentSettings,
  names: string[],
): Promise<Map<string, string>> {
  const profiles = await listStudentProfiles(app, settings);
  const aliasByName = new Map(profiles.map((profile) => [profile.name, profile.alias.trim()]));
  const sorted = [...new Set(names.filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh"));
  const map = new Map<string, string>();
  let index = 0;
  for (const name of sorted) {
    const alias = aliasByName.get(name) || `同学${String.fromCharCode(65 + (index % 26))}${index >= 26 ? index + 1 : ""}`;
    map.set(name, alias);
    index++;
  }
  return map;
}

function withExternalFrontmatter(markdown: string): string {
  if (!/^---\r?\n/.test(markdown)) return `---\nvisibility: external\n---\n\n${markdown}`;
  const close = markdown.indexOf("\n---", 4);
  if (close < 0) return markdown;
  return `${markdown.slice(0, close)}\nvisibility: external${markdown.slice(close)}`;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function blurImage(app: App, sourcePath: string, outputFolder: string, index: number): Promise<string | null> {
  try {
    const buffer = await app.vault.adapter.readBinary(normalizePath(sourcePath));
    const blob = new Blob([buffer]);
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.filter = "blur(18px)";
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const url = canvas.toDataURL("image/jpeg", 0.82);
    const base64 = url.split(",")[1] ?? "";
    if (!base64) return null;
    const target = `${outputFolder}/图片_${index + 1}.jpg`;
    await writeBinary(app, target, base64ToArrayBuffer(base64));
    return target;
  } catch {
    return null;
  }
}

export async function externalizeReport(
  app: App,
  settings: AssessmentSettings,
  markdown: string,
  reportFolder: string,
  studentNames: string[],
): Promise<string> {
  const aliases = await getAliasMap(app, settings, studentNames);
  let external = markdown;

  // 先移除同学卡片双链，避免别名替换后仍泄露真实路径
  external = external.replace(/\[\[[^\]]*\/03_学员\/[^\]]*\]\]/g, "（同学）");

  const names = [...aliases.keys()].sort((a, b) => b.length - a.length);
  for (const name of names) {
    const alias = aliases.get(name) ?? "同学";
    external = external.replace(new RegExp(escapeRegExp(name), "g"), alias);
  }

  const outputFolder = `${reportFolder}/对外图片`;
  await ensureFolder(app, outputFolder);
  const imagePattern = /!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  let index = 0;
  const replacements: Array<{ from: string; to: string }> = [];
  for (const match of external.matchAll(imagePattern)) {
    const path = match[1].trim();
    if (!/\.(jpg|jpeg|png|webp|gif|bmp|heic|heif)$/i.test(path)) continue;
    const blurred = await blurImage(app, path, outputFolder, index++);
    replacements.push({
      from: match[0],
      to: blurred ? `![[${blurred}]]\n\n> 照片已做模糊处理` : "> 照片已隐藏（对外版）",
    });
  }
  for (const replacement of replacements) external = external.replace(replacement.from, replacement.to);
  return withExternalFrontmatter(external);
}

export async function writeExternalReport(
  app: App,
  settings: AssessmentSettings,
  markdown: string,
  reportFolder: string,
  studentNames: string[],
  fileName: string,
): Promise<string> {
  const external = await externalizeReport(app, settings, markdown, reportFolder, studentNames);
  const path = `${reportFolder}/${fileName}`;
  await writeText(app, path, external);
  return path;
}
