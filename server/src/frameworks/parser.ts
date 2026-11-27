/* eslint-disable */
import { createHash } from "node:crypto";

export interface ParsedGoal {
  path: string;
  pathSegments: string[];
  goalId: string;
  title: string;
  dimension: string;
  levels: Record<string, string>;
}

export interface ParsedFramework {
  frameworkId: string;
  name: string;
  version: string;
  hash: string;
  levels: string[];
  goals: ParsedGoal[];
  errors: string[];
}

function frontmatterValue(frontmatter: string, key: string): string {
  const match = new RegExp(`^${key}\\s*:\\s*(.+)$`, "im").exec(frontmatter);
  return match ? match[1].replace(/^["']|["']$/g, "").trim() : "";
}

function splitFrontmatter(markdown: string): { frontmatter: string; body: string } {
  const normalized = markdown.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return { frontmatter: "", body: normalized };
  const end = normalized.indexOf("\n---", 4);
  if (end < 0) return { frontmatter: "", body: normalized };
  return {
    frontmatter: normalized.slice(4, end),
    body: normalized.slice(end + 4).replace(/^\n/, ""),
  };
}

export function frameworkFileHash(markdown: string): string {
  return `sha256:${createHash("sha256").update(markdown, "utf8").digest("hex")}`;
}

export function parseFrameworkMarkdown(markdown: string): ParsedFramework {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const frameworkId = frontmatterValue(frontmatter, "framework_id");
  const name = frontmatterValue(frontmatter, "name") || frameworkId;
  const version = frontmatterValue(frontmatter, "version");
  const errors: string[] = [];
  if (!frameworkId) errors.push("frontmatter 缺少 framework_id");
  if (!version) errors.push("frontmatter 缺少 version");

  const lines = body.split("\n");
  let header: string[] | null = null;
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const cells = cellsOf(lines[i]);
    if (!cells) continue;
    if (cells.some((cell) => /路径|path/i.test(cell)) && cells.some((cell) => /目标ID|goal\s*id/i.test(cell))) {
      header = cells;
      headerIndex = i;
      break;
    }
  }
  if (!header || headerIndex < 0) {
    return {
      frameworkId,
      name,
      version,
      hash: frameworkFileHash(markdown),
      levels: [],
      goals: [],
      errors: [...errors, "没有找到包含「路径 / 目标ID / 目标」的 Markdown 表格"],
    };
  }

  const pathIndex = header.findIndex((cell) => /路径|path/i.test(cell));
  const goalIndex = header.findIndex((cell) => /目标ID|goal\s*id/i.test(cell));
  const titleIndex = header.findIndex((cell) => /目标|goal/i.test(cell) && !/ID/i.test(cell));
  const dimensionIndex = header.findIndex((cell) => /维度|dimension/i.test(cell));
  const fixedIndexes = new Set([pathIndex, goalIndex, titleIndex, dimensionIndex].filter((index) => index >= 0));
  const levelIndexes: Array<{ index: number; key: string }> = [];
  header.forEach((cell, index) => {
    if (!fixedIndexes.has(index) && cell.trim()) levelIndexes.push({ index, key: cell.trim() });
  });
  const levels = levelIndexes.map((level) => level.key);
  if (pathIndex < 0) errors.push("量表缺少「路径」列");
  if (goalIndex < 0) errors.push("量表缺少「目标ID」列");
  if (titleIndex < 0) errors.push("量表缺少「目标」列");
  if (levels.length < 2) errors.push("量表至少需要两个 level 列");

  const goals: ParsedGoal[] = [];
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const cells = cellsOf(lines[i]);
    if (!cells) {
      if (goals.length) break;
      continue;
    }
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
    if (cells.length < header.length) {
      errors.push(`第 ${i + 1} 行单元格数量不足`);
      continue;
    }
    const path = cells[pathIndex]?.trim() ?? "";
    const goalId = cells[goalIndex]?.trim() ?? "";
    const title = cells[titleIndex]?.trim() ?? "";
    if (!path || !goalId || !title) {
      errors.push(`第 ${i + 1} 行缺少路径/目标ID/目标`);
      continue;
    }
    const rawSegments = path.split("/").map((segment) => segment.trim());
    const segments = rawSegments.filter(Boolean);
    if (segments.length < 1 || rawSegments.some((segment) => !segment)) {
      errors.push(`目标 ${goalId} 的路径为空或格式不正确`);
      continue;
    }
    if (seenIds.has(goalId)) errors.push(`目标 ID 重复：${goalId}`);
    if (seenPaths.has(path)) errors.push(`路径重复：${path}`);
    seenIds.add(goalId);
    seenPaths.add(path);
    const levelValues: Record<string, string> = {};
    for (const level of levelIndexes) levelValues[level.key] = cells[level.index]?.trim() ?? "";
    goals.push({
      path,
      pathSegments: segments,
      goalId,
      title,
      dimension: dimensionIndex >= 0 ? cells[dimensionIndex]?.trim() ?? "" : "",
      levels: levelValues,
    });
  }
  if (!goals.length) errors.push("量表没有目标数据行");
  return {
    frameworkId,
    name,
    version,
    hash: frameworkFileHash(markdown),
    levels,
    goals,
    errors,
  };
}

function cellsOf(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  return trimmed.split("|").slice(1, -1).map((cell) => cell.trim());
}
