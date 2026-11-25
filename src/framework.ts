/**
 * 多素养框架/量表：每个 Markdown 文件是一份行为量表。
 * 解析 frontmatter、目标 × level 表格，并负责框架查找、版本/哈希和报告上下文。
 */
import type { App } from "obsidian";
import { normalizePath } from "obsidian";
import { createHash } from "crypto";
import type {
  ActivityRecord,
  AssessmentSettings,
  FrameworkDefinition,
  FrameworkGoal,
  FrameworkLevel,
  FrameworkRef,
  SeriesRecord,
} from "./types";
import { splitFrontmatter, stemOf } from "./core";

export const FRAMEWORK_FOLDER = "00_框架";

export interface FrameworkContext {
  text: string;
  definitions: FrameworkDefinition[];
  refs: FrameworkRef[];
  versions: string[];
  hashes: string[];
}

export function frameworkRoot(settings: AssessmentSettings): string {
  return `${settings.dataRoot}/${FRAMEWORK_FOLDER}`;
}

export function frameworkHash(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function metaValue(frontmatter: string, key: string): string {
  const match = new RegExp(`^${key}\\s*:\\s*(.+)$`, "im").exec(frontmatter);
  return match ? match[1].replace(/^["']|["']$/g, "").trim() : "";
}

function boolValue(value: string): boolean {
  return /^(true|yes|1)$/i.test(value.trim());
}

function parseTable(lines: string[]): { levels: FrameworkLevel[]; goals: FrameworkGoal[]; errors: string[] } {
  const errors: string[] = [];
  let header: string[] | null = null;
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (!cells.some((c) => /目标|目标ID|goal/i.test(c))) continue;
    if (cells.length < 4) continue;
    header = cells;
    headerIndex = i;
    break;
  }
  if (!header || headerIndex < 0) {
    return { levels: [], goals: [], errors: ["没有找到目标×level 的 Markdown 表格"] };
  }
  const idIndex = header.findIndex((h) => /目标ID|目标id|goal\s*id/i.test(h));
  const titleIndex = header.findIndex((h) => /目标|goal/i.test(h) && !/ID/i.test(h));
  const dimIndex = header.findIndex((h) => /维度|dimension/i.test(h));
  const fixed = new Set([idIndex, titleIndex, dimIndex].filter((i) => i >= 0));
  const levelIndexes: Array<{ index: number; key: string }> = [];
  header.forEach((cell, index) => {
    if (!fixed.has(index) && cell.trim()) levelIndexes.push({ index, key: cell.trim() });
  });
  if (idIndex < 0 || titleIndex < 0) errors.push("量表缺少「目标ID」或「目标」列");
  if (levelIndexes.length < 2) errors.push("量表至少需要两个 level 列");
  const levels = levelIndexes.map((item) => ({ key: item.key, label: item.key }));
  const goals: FrameworkGoal[] = [];
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("|")) {
      if (goals.length) break;
      continue;
    }
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    if (cells.length < header.length) continue;
    const id = cells[idIndex] ?? "";
    const title = cells[titleIndex] ?? "";
    if (!id || !title) continue;
    const levelMap: Record<string, string> = {};
    for (const item of levelIndexes) levelMap[item.key] = cells[item.index] ?? "";
    goals.push({
      id,
      title,
      dimension: dimIndex >= 0 ? cells[dimIndex] ?? "" : "",
      levels: levelMap,
    });
  }
  if (!goals.length) errors.push("量表没有目标数据行");
  return { levels, goals, errors };
}

export function parseFrameworkText(path: string, text: string): FrameworkDefinition {
  const { frontmatter, body } = splitFrontmatter(text);
  const id = metaValue(frontmatter, "framework_id") || stemOf(path);
  const name = metaValue(frontmatter, "name") || stemOf(path);
  const version = metaValue(frontmatter, "version") || "1";
  const status = metaValue(frontmatter, "status") || "active";
  const mandatory = boolValue(metaValue(frontmatter, "mandatory"));
  const orgId = metaValue(frontmatter, "org_id");
  const parsed = parseTable(body.split(/\r?\n/));
  const levels = parsed.levels;
  const goals = parsed.goals;
  const errors = [...parsed.errors];
  if (!id) errors.push("framework_id 为空");
  if (!levels.length) errors.push("没有解析到 level");
  if (!goals.length) errors.push("没有解析到目标");
  return {
    id,
    name,
    version,
    status,
    path: normalizePath(path),
    hash: frameworkHash(text),
    levels,
    goals,
    errors,
    mandatory,
    orgId,
  };
}

export function frameworkFiles(app: App, settings: AssessmentSettings): string[] {
  const root = normalizePath(`${frameworkRoot(settings)}/`);
  return app.vault
    .getFiles()
    .filter((file) => file.extension === "md")
    .map((file) => file.path)
    .filter((path) => path.startsWith(root))
    .filter((path) => !path.includes("/_历史/") && !path.includes("/_组织/"))
    .sort((a, b) => a.localeCompare(b, "zh"));
}

export async function loadFramework(app: App, path: string): Promise<FrameworkDefinition | null> {
  const file = app.vault.getAbstractFileByPath(normalizePath(path));
  if (!file || !(file as { extension?: string }).extension) return null;
  const text = await app.vault.adapter.read(normalizePath(path));
  return parseFrameworkText(path, text);
}

export async function listFrameworks(app: App, settings: AssessmentSettings): Promise<FrameworkDefinition[]> {
  const out: FrameworkDefinition[] = [];
  for (const path of frameworkFiles(app, settings)) {
    const framework = await loadFramework(app, path);
    if (framework) out.push(framework);
  }
  // 兼容旧版单一 frameworkPath（可能在 00_框架/ 之外）
  if (settings.frameworkPath) {
    const legacyPath = normalizePath(settings.frameworkPath);
    if (!out.some((item) => item.path === legacyPath)) {
      const legacy = await loadFramework(app, legacyPath);
      if (legacy) {
        if (!legacy.id) legacy.id = "legacy-framework";
        out.push(legacy);
      }
    }
  }
  const byId = new Map<string, FrameworkDefinition>();
  for (const framework of out) {
    const existing = byId.get(framework.id);
    if (!existing || compareVersion(framework.version, existing.version) > 0) byId.set(framework.id, framework);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "zh"));
}

function compareVersion(a: string, b: string): number {
  const av = a.split(/[.\-]/).map((n) => Number(n) || 0);
  const bv = b.split(/[.\-]/).map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const diff = (av[i] || 0) - (bv[i] || 0);
    if (diff) return diff;
  }
  return a.localeCompare(b);
}

export async function findFramework(
  app: App,
  settings: AssessmentSettings,
  id: string,
): Promise<FrameworkDefinition | null> {
  const frameworks = await listFrameworks(app, settings);
  return frameworks.find((item) => item.id === id) ?? null;
}

export async function resolveFrameworkRefs(
  app: App,
  settings: AssessmentSettings,
  record?: ActivityRecord | SeriesRecord,
): Promise<FrameworkRef[]> {
  const refs = (record?.meta as { framework_refs?: FrameworkRef[] } | undefined)?.framework_refs;
  if (refs?.length) return refs;
  const frameworks = await listFrameworks(app, settings);
  if (frameworks.length) return [{ id: frameworks[0].id, role: "primary" }];
  return [];
}

export async function buildFrameworkContext(
  app: App,
  settings: AssessmentSettings,
  refs: FrameworkRef[],
): Promise<FrameworkContext> {
  const definitions: FrameworkDefinition[] = [];
  for (const ref of refs) {
    const framework = await findFramework(app, settings, ref.id);
    if (framework) definitions.push(framework);
  }
  const text = definitions
    .map((f) => `# ${f.name}（${f.id} / v${f.version}）\n\n${f.goals.map((g) => `- ${g.id} ${g.title}：${Object.entries(g.levels).map(([k, v]) => `${k}=${v}`).join("；")}`).join("\n")}`)
    .join("\n\n---\n\n");
  return {
    text,
    definitions,
    refs,
    versions: definitions.map((f) => `${f.id}@${f.version}`),
    hashes: definitions.map((f) => `${f.id}@${f.hash}`),
  };
}

export function primaryFrameworkId(refs: FrameworkRef[]): string {
  return refs.find((ref) => ref.role === "primary")?.id ?? refs[0]?.id ?? "";
}
