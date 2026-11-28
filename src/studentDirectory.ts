import { Modal, type App } from "obsidian";
import type { AssessmentSettings } from "./types";
import { listActivities } from "./vault";
import { listStudents } from "./stage";
import { readProfile } from "./profile";
import { orgStudentSummaries, orgSyncStudentSummaries, type OrgStudentSummaryRow } from "./org";

export interface LocalStudentSummary {
  name: string;
  currentLevels: Array<{ frameworkId?: string; frameworkName?: string; goal: string; level: string; updatedAt?: string }>;
  activityCount: number;
  evidenceCount: number;
  lastActivityAt?: string;
  summary: string;
}

export async function buildStudentSummaries(
  app: App,
  settings: AssessmentSettings,
): Promise<LocalStudentSummary[]> {
  const [students, activities] = await Promise.all([listStudents(app, settings), listActivities(app, settings)]);
  const result: LocalStudentSummary[] = [];
  for (const student of students) {
    const related = activities.filter((activity) => activity.meta.participants.includes(student));
    const profile = await readProfile(app, settings, student);
    const levelMap = new Map<string, LocalStudentSummary["currentLevels"][number]>();
    for (const level of profile.levels) {
      const previous = levelMap.get(level.goal);
      if (!previous || String(level.updatedAt).localeCompare(String(previous.updatedAt)) >= 0) {
        levelMap.set(level.goal, {
          frameworkId: level.frameworkId,
          frameworkName: level.frameworkName,
          goal: level.goal,
          level: level.level,
          updatedAt: level.updatedAt,
        });
      }
    }
    const levels = [...levelMap.values()];
    const latestChallenge = profile.challenges[profile.challenges.length - 1];
    const summary = latestChallenge
      ? `${latestChallenge.action}：${latestChallenge.challenge}（${latestChallenge.fromLevel} → ${latestChallenge.toLevel}）`
      : levels.slice(0, 5).map((level) => `${level.goal} ${level.level}`).join("；");
    const lastActivityAt = related
      .map((activity) => activity.meta.date)
      .filter(Boolean)
      .sort()
      .pop();
    result.push({
      name: student,
      currentLevels: levels,
      activityCount: related.length,
      evidenceCount: profile.levels.length + profile.history.length,
      lastActivityAt,
      summary: summary.slice(0, 1000),
    });
  }
  return result;
}

export async function syncStudentSummariesToOrg(app: App, settings: AssessmentSettings): Promise<number> {
  if (!settings.studentSyncEnabled) throw new Error("尚未开启「同步同学结构化摘要」。");
  const students = await buildStudentSummaries(app, settings);
  const result = await orgSyncStudentSummaries(students);
  return result.synced;
}

export class OrgStudentDirectoryModal extends Modal {
  constructor(
    app: App,
    private readonly rows: OrgStudentSummaryRow[],
    private readonly teamName: string,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "团队同学汇总" });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: `${this.teamName || "当前团队"} · 只显示导师主动同步的结构化摘要，不包含原始素材和报告正文。`,
    });
    const grouped = new Map<string, OrgStudentSummaryRow[]>();
    for (const row of this.rows) {
      const list = grouped.get(row.id) ?? [];
      list.push(row);
      grouped.set(row.id, list);
    }
    if (!grouped.size) {
      contentEl.createEl("p", { cls: "la-hint", text: "还没有同学摘要。先在设置里开启同步，或让导师执行同步。" });
      return;
    }
    const list = contentEl.createDiv({ cls: "la-student-directory" });
    for (const items of grouped.values()) {
      const first = items[0];
      const card = list.createDiv({ cls: "la-student-card" });
      card.createEl("h3", { text: `${first.name} · ${first.teamName || "未分团队"}` });
      card.createEl("p", {
        cls: "la-hint",
        text: `导师：${items.map((item) => item.memberName).join("、")}`,
      });
      const levels = items.flatMap((item) => item.currentLevels);
      if (levels.length) {
        card.createEl("p", { text: levels.slice(0, 12).map((level) => `${level.goal} ${level.level}`).join("；") });
      }
      const activityCount = items.reduce((sum, item) => sum + item.activityCount, 0);
      const evidenceCount = items.reduce((sum, item) => sum + item.evidenceCount, 0);
      card.createEl("p", {
        cls: "la-hint",
        text: `参与行动 ${activityCount} 次 · 结构化证据 ${evidenceCount} 条 · 最近 ${first.lastActivityAt ? new Date(first.lastActivityAt).toLocaleDateString("zh-CN") : "暂无"}`,
      });
      const summaries = items.map((item) => item.summary).filter(Boolean).slice(0, 3);
      if (summaries.length) card.createEl("p", { text: summaries.join("\n") });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export async function openStudentDirectory(app: App): Promise<void> {
  const data = await orgStudentSummaries();
  new OrgStudentDirectoryModal(app, data.students, data.teamName).open();
}
