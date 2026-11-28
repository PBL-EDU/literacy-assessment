import type { FrameworkDefinition, TargetRef } from "./types";
import { hashString, splitFrontmatter } from "./core";

export type PlanKind = "project" | "action";

export interface PlanTargetRow {
  kind: "framework" | "custom";
  source: "tenant" | "team" | "personal";
  frameworkId: string;
  goalId: string;
  title: string;
  path: string;
  expectedLevel?: string;
  expectedLevelText?: string;
  description?: string;
}

export interface ParsedPlan {
  kind: PlanKind;
  planId: string;
  title: string;
  project: string;
  mentor: string;
  date: string;
  description: string;
  targets: PlanTargetRow[];
  errors: string[];
}

function frontmatterValue(frontmatter: string, key: string): string {
  const match = new RegExp(`^${key}\\s*:\\s*(.+)$`, "im").exec(frontmatter);
  return match ? match[1].replace(/^["']|["']$/g, "").trim() : "";
}

function cellsOf(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  return trimmed.split("|").slice(1, -1).map((cell) => cell.trim());
}

function section(body: string, names: string[]): string {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => names.some((name) => line.trim() === `## ${name}`));
  if (start < 0) return "";
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,3}\s/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n").trim();
}

export function parsePlanMarkdown(markdown: string): ParsedPlan {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const type = frontmatterValue(frontmatter, "type");
  const kind: PlanKind = type.includes("action") || type === "action" ? "action" : "project";
  const errors: string[] = [];
  const planId = frontmatterValue(frontmatter, "plan_id");
  const title = frontmatterValue(frontmatter, "title");
  if (!planId) errors.push("frontmatter 缺少 plan_id");
  if (!title) errors.push("frontmatter 缺少 title");
  if (type && !/literacy-(project|action)-plan|project|action/i.test(type)) {
    errors.push(`不支持的 type：${type}`);
  }

  const lines = body.split(/\r?\n/);
  let header: string[] | null = null;
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const cells = cellsOf(lines[i]);
    if (!cells) continue;
    if (cells.some((cell) => /类型|type/i.test(cell)) && cells.some((cell) => /目标|goal/i.test(cell))) {
      header = cells;
      headerIndex = i;
      break;
    }
  }
  const targets: PlanTargetRow[] = [];
  if (!header || headerIndex < 0) {
    errors.push("没有找到目标表（至少需要类型、目标列）");
  } else {
    const typeIndex = header.findIndex((cell) => /类型|type/i.test(cell));
    const sourceIndex = header.findIndex((cell) => /来源|source/i.test(cell));
    const frameworkIndex = header.findIndex((cell) => /框架ID|framework\s*id/i.test(cell));
    const goalIndex = header.findIndex((cell) => /目标ID|goal\s*id/i.test(cell));
    const titleIndex = header.findIndex((cell) => /目标|goal/i.test(cell) && !/ID/i.test(cell));
    const pathIndex = header.findIndex((cell) => /路径|path/i.test(cell));
    const levelIndex = header.findIndex((cell) => /期望\s*level|expected\s*level/i.test(cell));
    for (let i = headerIndex + 1; i < lines.length; i++) {
      const cells = cellsOf(lines[i]);
      if (!cells) {
        if (targets.length) break;
        continue;
      }
      if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
      if (cells.length < header.length) {
        errors.push(`第 ${i + 1} 行单元格数量不足`);
        continue;
      }
      const rowType = cells[typeIndex]?.trim().toLowerCase() || "framework";
      const targetTitle = cells[titleIndex]?.trim() || "";
      if (!targetTitle) {
        errors.push(`第 ${i + 1} 行缺少目标标题`);
        continue;
      }
      if (rowType === "custom" || rowType === "其他" || rowType === "自定义") {
        targets.push({
          kind: "custom",
          source: "team",
          frameworkId: "",
          goalId: cells[goalIndex]?.trim() || `custom_${hashString(targetTitle).slice(0, 10)}`,
          title: targetTitle,
          path: "",
          expectedLevelText: levelIndex >= 0 ? cells[levelIndex]?.trim() : "",
        });
        continue;
      }
      const sourceRaw = (sourceIndex >= 0 ? cells[sourceIndex] : "tenant").trim();
      const source = sourceRaw === "team" || sourceRaw === "personal" ? sourceRaw : "tenant";
      const frameworkId = frameworkIndex >= 0 ? cells[frameworkIndex]?.trim() ?? "" : "";
      const goalId = goalIndex >= 0 ? cells[goalIndex]?.trim() ?? "" : "";
      if (!frameworkId || !goalId) {
        errors.push(`第 ${i + 1} 行框架目标缺少 frameworkId 或 goalId`);
        continue;
      }
      const path = (pathIndex >= 0 ? cells[pathIndex]?.trim() : "") || targetTitle;
      targets.push({
        kind: "framework",
        source,
        frameworkId,
        goalId,
        title: targetTitle,
        path,
        expectedLevel: levelIndex >= 0 ? cells[levelIndex]?.trim() : undefined,
      });
    }
  }
  if (!targets.length) errors.push("目标表没有有效目标");

  return {
    kind,
    planId,
    title,
    project: frontmatterValue(frontmatter, "project"),
    mentor: frontmatterValue(frontmatter, "mentor"),
    date: frontmatterValue(frontmatter, "date"),
    description: section(body, ["说明", "Description"]),
    targets,
    errors,
  };
}

export function resolvePlanTargets(
  plan: ParsedPlan,
  frameworks: FrameworkDefinition[],
): { targets: TargetRef[]; errors: string[] } {
  const targets: TargetRef[] = [];
  const errors: string[] = [];
  for (const row of plan.targets) {
    if (row.kind === "custom") {
      targets.push({
        kind: "custom",
        frameworkId: "",
        frameworkName: "",
        frameworkVersion: "",
        goalId: row.goalId,
        path: "",
        title: row.title,
        expectedLevelText: row.expectedLevelText || undefined,
      });
      continue;
    }
    const framework = frameworks.find(
      (item) => item.id === row.frameworkId && (item.source ?? "tenant") === row.source,
    );
    if (!framework) {
      errors.push(`找不到框架：${row.source}/${row.frameworkId}`);
      continue;
    }
    const goal = framework.goals.find((item) => item.id === row.goalId);
    if (!goal) {
      errors.push(`框架 ${row.frameworkId} 中找不到目标 ${row.goalId}`);
      continue;
    }
    if (row.expectedLevel && !framework.levels.some((level) => level.key === row.expectedLevel)) {
      errors.push(`目标 ${row.goalId} 的期望 level 不在框架中：${row.expectedLevel}`);
      continue;
    }
    targets.push({
      kind: "framework",
      source: row.source,
      frameworkId: framework.id,
      frameworkName: framework.name,
      frameworkVersion: framework.version,
      goalId: goal.id,
      path: goal.path || goal.title,
      title: goal.title,
      expectedLevel: row.expectedLevel || undefined,
    });
  }
  return { targets, errors };
}
