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
  TargetRef,
  TargetSource,
} from "./types";
import { sanitizeName, splitFrontmatter, stemOf } from "./core";
import { ensureFolder } from "./vault";
import { orgActive, orgFrameworks } from "./org";

export const FRAMEWORK_FOLDER = "00_框架";
export const TENANT_FRAMEWORK_FOLDER = "_租户";
export const TEAM_FRAMEWORK_FOLDER = "_团队";
export const PERSONAL_FRAMEWORK_FOLDER = "_个人";

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

export function frameworkSourceForPath(path: string): TargetSource {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.includes(`/${TEAM_FRAMEWORK_FOLDER}/`)) return "team";
  if (normalized.includes(`/${PERSONAL_FRAMEWORK_FOLDER}/`)) return "personal";
  if (normalized.includes(`/${TENANT_FRAMEWORK_FOLDER}/`) || normalized.includes("/_组织/")) return "tenant";
  return "team";
}

export function frameworkSourceLabel(source: TargetSource | undefined): string {
  return source === "tenant" ? "组织框架" : source === "team" ? "团队框架" : source === "personal" ? "导师框架" : "本地框架";
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
  const pathIndex = header.findIndex((h) => /路径|path/i.test(h));
  const idIndex = header.findIndex((h) => /目标ID|目标id|goal\s*id/i.test(h));
  const titleIndex = header.findIndex((h) => /目标|goal/i.test(h) && !/ID/i.test(h) && !/路径|path/i.test(h));
  const dimIndex = header.findIndex((h) => /维度|dimension/i.test(h));
  const fixed = new Set([pathIndex, idIndex, titleIndex, dimIndex].filter((i) => i >= 0));
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
    const path = pathIndex >= 0 ? cells[pathIndex] ?? "" : title;
    goals.push({
      id,
      title,
      dimension: dimIndex >= 0 ? cells[dimIndex] ?? "" : "",
      path,
      pathSegments: path.split("/").map((segment) => segment.trim()).filter(Boolean),
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
    source: frameworkSourceForPath(path),
  };
}

export function frameworkFiles(app: App, settings: AssessmentSettings): string[] {
  const root = normalizePath(`${frameworkRoot(settings)}/`);
  return app.vault
    .getFiles()
    .filter((file) => file.extension === "md")
    .map((file) => file.path)
    .filter((path) => path.startsWith(root))
    .filter((path) => !path.includes("/_历史/"))
    .filter((path) => {
      if (path.includes("/_组织/")) return path.startsWith(`${root}_组织/cache/`);
      return true;
    })
    .sort((a, b) => a.localeCompare(b, "zh"));
}

export async function loadFramework(app: App, path: string): Promise<FrameworkDefinition | null> {
  const file = app.vault.getAbstractFileByPath(normalizePath(path));
  if (!file || !(file as { extension?: string }).extension) return null;
  const text = await app.vault.adapter.read(normalizePath(path));
  return parseFrameworkText(path, text);
}

export async function listFrameworks(app: App, settings: AssessmentSettings): Promise<FrameworkDefinition[]> {
  if (orgActive()) {
    try {
      const remote = await orgFrameworks();
      const cacheRoot = `${frameworkRoot(settings)}/${TENANT_FRAMEWORK_FOLDER}/cache`;
      await ensureFolder(app, cacheRoot);
      return Promise.all(remote.map(async (item) => {
        const parsed = parseFrameworkText(`org://${item.frameworkId}`, item.markdown);
        const framework = {
          ...parsed,
          id: item.frameworkId || parsed.id,
          name: item.name || parsed.name,
          version: item.version || parsed.version,
          hash: item.hash || parsed.hash,
          status: "active",
          source: "tenant" as const,
        };
        try {
          await app.vault.adapter.write(
            normalizePath(`${cacheRoot}/${sanitizeName(framework.id)}.md`),
            item.markdown,
          );
        } catch {
          /* 缓存写入失败不影响本次使用 */
        }
        return framework;
      }));
    } catch {
      // 组织网关暂时不可用时使用本地缓存/文件，避免整个侧栏无法工作。
    }
  }
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
    const key = `${framework.source ?? "team"}::${framework.id}`;
    const existing = byId.get(key);
    if (!existing || compareVersion(framework.version, existing.version) > 0) byId.set(key, framework);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "zh"));
}

function compareVersion(a: string, b: string): number {
  const av = a.split(/[.-]/).map((n) => Number(n) || 0);
  const bv = b.split(/[.-]/).map((n) => Number(n) || 0);
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
  source?: TargetSource,
): Promise<FrameworkDefinition | null> {
  const frameworks = await listFrameworks(app, settings);
  return (
    frameworks.find((item) => item.id === id && (!source || (item.source ?? "team") === source)) ?? null
  );
}

export async function resolveFrameworkRefs(
  app: App,
  settings: AssessmentSettings,
  record?: ActivityRecord | SeriesRecord,
): Promise<FrameworkRef[]> {
  const refs = (record?.meta as { framework_refs?: FrameworkRef[] } | undefined)?.framework_refs;
  if (refs?.length) return refs;
  const frameworks = await listFrameworks(app, settings);
  if (frameworks.length) return [{ id: frameworks[0].id, role: "primary", source: frameworks[0].source }];
  return [];
}

export async function buildFrameworkContext(
  app: App,
  settings: AssessmentSettings,
  refs: FrameworkRef[],
  targets?: TargetRef[],
): Promise<FrameworkContext> {
  const definitions: FrameworkDefinition[] = [];
  for (const ref of refs) {
    const framework = await findFramework(app, settings, ref.id, ref.source);
    if (framework) definitions.push(framework);
  }
  const selectedGoalIds = new Set(
    (targets ?? [])
      .filter((target) => target.kind !== "custom")
      .map((target) => `${target.source ?? "tenant"}::${target.frameworkId}::${target.goalId}`),
  );
  const text = definitions
    .map((f) => {
      const source = f.source ?? "tenant";
      const goals = f.goals.filter(
        (g) => !selectedGoalIds.size || selectedGoalIds.has(`${source}::${f.id}::${g.id}`),
      );
      return `# ${f.name}（${f.id} / v${f.version}）\n\n${goals.map((g) => `- ${g.path || g.title}（${g.id}）：${Object.entries(g.levels).map(([k, v]) => `${k}=${v}`).join("；")}`).join("\n")}`;
    })
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
