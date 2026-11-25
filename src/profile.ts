/**
 * 学生素养档案：当前 level、素养挑战、历史；与作品集分离，作品集用块引用同步。
 */
import type { App } from "obsidian";
import { normalizePath } from "obsidian";
import type {
  AssessmentSettings,
  LevelDecision,
  FrameworkRef,
} from "./types";
import { sanitizeName, nowISO } from "./core";
import {
  createStudentProfile,
  ensureFolder,
  findStudentNote,
  pathExists,
  readText,
  writeText,
  yamlValue,
} from "./vault";

export interface ProfileLevel {
  frameworkId: string;
  frameworkName: string;
  goal: string;
  level: string;
  evidence: string;
  updatedAt: string;
  reviewer: string;
  reportPath: string;
}

export interface ProfileChallenge {
  date: string;
  action: string;
  project: string;
  framework: string;
  goal: string;
  challenge: string;
  fromLevel: string;
  toLevel: string;
  reportPath: string;
}

export interface ProfileHistory {
  date: string;
  goal: string;
  fromLevel: string;
  toLevel: string;
  reportPath: string;
  reviewer: string;
}

export interface ProfileData {
  student: string;
  levels: ProfileLevel[];
  challenges: ProfileChallenge[];
  history: ProfileHistory[];
}

export function profileFolder(settings: AssessmentSettings, student: string): string {
  return `${settings.dataRoot}/03_学员/${sanitizeName(student)}`;
}

export function profileJsonPath(settings: AssessmentSettings, student: string): string {
  return `${profileFolder(settings, student)}/素养档案.json`;
}

export function profileMarkdownPath(settings: AssessmentSettings, student: string): string {
  return `${profileFolder(settings, student)}/素养档案.md`;
}

function emptyProfile(student: string): ProfileData {
  return { student, levels: [], challenges: [], history: [] };
}

export async function readProfile(
  app: App,
  settings: AssessmentSettings,
  student: string,
): Promise<ProfileData> {
  const path = profileJsonPath(settings, student);
  if (!(await pathExists(app, path))) return emptyProfile(student);
  try {
    const data = JSON.parse(await readText(app, path)) as Partial<ProfileData>;
    return {
      student: data.student || student,
      levels: Array.isArray(data.levels) ? data.levels : [],
      challenges: Array.isArray(data.challenges) ? data.challenges : [],
      history: Array.isArray(data.history) ? data.history : [],
    };
  } catch {
    return emptyProfile(student);
  }
}

export function renderProfileMarkdown(profile: ProfileData): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push("type: literacy-profile");
  lines.push(`student: ${yamlValue(profile.student)}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${profile.student}的素养档案`);
  lines.push("");
  lines.push("## 当前素养");
  lines.push("");
  lines.push("| 框架 | 目标 | 当前 level | 最近证据 | 更新时间 | 审核人 |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  if (profile.levels.length) {
    for (const level of profile.levels) {
      lines.push(
        `| ${level.frameworkName || level.frameworkId} | ${level.goal} | ${level.level} | ${level.evidence || "—"} | ${level.updatedAt || "—"} | ${level.reviewer || "—"} |`,
      );
    }
  } else {
    lines.push("| — | — | — | — | — | — |");
  }
  lines.push("");
  lines.push("## 素养挑战");
  lines.push("");
  lines.push("| 日期 | 行动/项目 | 框架 | 目标 | 挑战 | level 变化 | 报告 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  if (profile.challenges.length) {
    for (const item of profile.challenges) {
      const place = [item.project, item.action].filter(Boolean).join(" / ") || "—";
      const report = item.reportPath ? `[[${item.reportPath}|查看报告]]` : "—";
      lines.push(
        `| ${item.date} | ${place} | ${item.framework} | ${item.goal} | ${item.challenge} | ${item.fromLevel} → ${item.toLevel} | ${report} |`,
      );
    }
  } else {
    lines.push("| — | — | — | — | — | — | — |");
  }
  lines.push("");
  lines.push("## 历史");
  lines.push("");
  lines.push("| 日期 | 目标 | 原 level | 新 level | 报告 | 审核人 |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  if (profile.history.length) {
    for (const item of profile.history) {
      const report = item.reportPath ? `[[${item.reportPath}|查看报告]]` : "—";
      lines.push(
        `| ${item.date} | ${item.goal} | ${item.fromLevel} | ${item.toLevel} | ${report} | ${item.reviewer} |`,
      );
    }
  } else {
    lines.push("| — | — | — | — | — | — |");
  }
  lines.push("");
  return lines.join("\n");
}

export async function ensureLiteracyProfile(
  app: App,
  settings: AssessmentSettings,
  student: string,
): Promise<ProfileData> {
  const name = student.trim();
  if (!name) return emptyProfile(student);
  const folder = profileFolder(settings, name);
  await ensureFolder(app, normalizePath(folder));
  const jsonPath = profileJsonPath(settings, name);
  let profile = await readProfile(app, settings, name);
  if (!(await pathExists(app, jsonPath))) {
    profile = emptyProfile(name);
    await writeText(app, jsonPath, `${JSON.stringify(profile, null, 2)}\n`);
  }
  await writeText(app, profileMarkdownPath(settings, name), renderProfileMarkdown(profile));
  await ensurePortfolioBlock(app, settings, name);
  return profile;
}

export async function ensurePortfolioBlock(
  app: App,
  settings: AssessmentSettings,
  student: string,
): Promise<void> {
  const folder = profileFolder(settings, student);
  let notePath = await findStudentNote(app, folder);
  if (!notePath) {
    await createStudentProfile(app, settings, student);
    notePath = await findStudentNote(app, folder);
  }
  if (!notePath) return;
  const profilePath = profileMarkdownPath(settings, student);
  const block = `<!-- literacy-profile:start -->\n![[${profilePath.replace(/\.md$/i, "")}#当前素养]]\n<!-- literacy-profile:end -->`;
  const text = await readText(app, notePath);
  const start = text.indexOf("<!-- literacy-profile:start -->");
  const end = text.indexOf("<!-- literacy-profile:end -->");
  let next: string;
  if (start >= 0 && end > start) {
    next = `${text.slice(0, start)}${block}${text.slice(end + "<!-- literacy-profile:end -->".length)}`;
  } else {
    next = `${text.trimEnd()}\n\n## 素养档案\n\n${block}\n`;
  }
  if (next !== text) await writeText(app, notePath, next);
}

export async function applyLevelDecision(
  app: App,
  settings: AssessmentSettings,
  decision: LevelDecision,
  options: {
    action?: string;
    project?: string;
    challenge?: string;
    frameworkName?: string;
    reportPath?: string;
    reviewer?: string;
  } = {},
): Promise<ProfileData> {
  const profile = await ensureLiteracyProfile(app, settings, decision.student);
  const finalLevel = decision.final_level || decision.current_level;
  if (decision.decision === "approved" || decision.decision === "modified") {
    const previous = profile.levels.find(
      (item) => item.frameworkId === decision.framework_id && item.goal === decision.goal,
    );
    const from = previous?.level || decision.current_level;
    const level: ProfileLevel = {
      frameworkId: decision.framework_id,
      frameworkName: options.frameworkName || decision.framework_id,
      goal: decision.goal,
      level: finalLevel,
      evidence: options.reportPath || "",
      updatedAt: decision.decided_at || nowISO(),
      reviewer: options.reviewer || "本地导师",
      reportPath: options.reportPath || "",
    };
    profile.levels = [
      ...profile.levels.filter(
        (item) => !(item.frameworkId === decision.framework_id && item.goal === decision.goal),
      ),
      level,
    ];
    profile.history.push({
      date: (decision.decided_at || nowISO()).slice(0, 10),
      goal: decision.goal,
      fromLevel: from,
      toLevel: finalLevel,
      reportPath: options.reportPath || "",
      reviewer: options.reviewer || "本地导师",
    });
    profile.challenges.push({
      date: (decision.decided_at || nowISO()).slice(0, 10),
      action: options.action || "",
      project: options.project || "",
      framework: options.frameworkName || decision.framework_id,
      goal: decision.goal,
      challenge: options.challenge || decision.note || "素养挑战",
      fromLevel: from,
      toLevel: finalLevel,
      reportPath: options.reportPath || "",
    });
    await writeText(app, profileJsonPath(settings, decision.student), `${JSON.stringify(profile, null, 2)}\n`);
    await writeText(app, profileMarkdownPath(settings, decision.student), renderProfileMarkdown(profile));
    await ensurePortfolioBlock(app, settings, decision.student);
  }
  return profile;
}

export function profileLinkFor(settings: AssessmentSettings, student: string): string {
  return `[[${profileMarkdownPath(settings, student).replace(/\.md$/i, "")}|${student}的素养档案]]`;
}

export function profileHasFramework(profile: ProfileData, frameworkId: string): boolean {
  return profile.levels.some((level) => level.frameworkId === frameworkId);
}

export function frameworksInProfile(profile: ProfileData): FrameworkRef[] {
  return [...new Set(profile.levels.map((level) => level.frameworkId))].map((id) => ({ id, role: "primary" as const }));
}
