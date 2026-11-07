/**
 * 活动评估：把活动笔记、观察、转写、图像说明交给 AI，
 * 产出证据 JSON + 活动成长报告。
 */
import type { App } from "obsidian";
import type { ActivityAssessment, ActivityRecord, AssessmentSettings, ContextBlock } from "./types";
import { SUBFOLDERS } from "./types";
import {
  activityReportFileName,
  buildContext,
  classifyFile,
  normalizeActivityAssessment,
  resolveFrameworkPath,
} from "./core";
import { buildActivityMessages } from "./prompt";
import { chatJson } from "./ai";
import { renderActivityReport, renderEvidenceNote } from "./report";
import { pathExists, readText, updateActivityStatus, walkFiles, writeText } from "./vault";
import { writeExternalReport } from "./external";
import type { ProgressSink } from "./organize";

export async function readFramework(app: App, settings: AssessmentSettings): Promise<string> {
  const path = resolveFrameworkPath(settings);
  if (!(await pathExists(app, path))) return "";
  try {
    return (await readText(app, path)).slice(0, 20_000);
  } catch {
    return "";
  }
}

async function collectBlocks(app: App, record: ActivityRecord): Promise<ContextBlock[]> {
  const blocks: ContextBlock[] = [];
  const folder = record.folder;

  // 1. 导师观察优先
  for (const file of await walkFiles(app, `${folder}/${SUBFOLDERS.observations}`)) {
    if (!/\.(md|markdown|txt)$/i.test(file)) continue;
    try {
      const text = await readText(app, file);
      if (text.trim()) blocks.push({ label: file.replace(`${folder}/`, ""), text, priority: 1 });
    } catch {
      /* 跳过 */
    }
  }

  // 2. 行动笔记正文（教学目标、流程、导师随手记）
  if (record.body.trim().length > 20) {
    blocks.push({ label: "行动笔记", text: record.body, priority: 2 });
  }

  // 3. 转写与图像说明
  for (const file of await walkFiles(app, `${folder}/${SUBFOLDERS.transcripts}`)) {
    if (!/\.(md|markdown|txt)$/i.test(file)) continue;
    try {
      const text = await readText(app, file);
      if (text.trim()) blocks.push({ label: file.replace(`${folder}/`, ""), text, priority: 3 });
    } catch {
      /* 跳过 */
    }
  }

  // 4. 素材里的文字学习单/学生复盘
  for (const file of await walkFiles(app, `${folder}/${SUBFOLDERS.materials}`)) {
    if (!/\.(md|markdown|txt|csv)$/i.test(file)) continue;
    try {
      const text = await readText(app, file);
      if (text.trim()) blocks.push({ label: file.replace(`${folder}/`, ""), text, priority: 4 });
    } catch {
      /* 跳过 */
    }
  }

  return blocks;
}

async function collectPhotoPaths(app: App, record: ActivityRecord): Promise<string[]> {
  const photos: string[] = [];
  for (const file of await walkFiles(app, `${record.folder}/${SUBFOLDERS.materials}`)) {
    if (classifyFile(file) === "image") photos.push(file);
  }
  return photos.slice(0, 20);
}

export interface AssessmentResult {
  assessment: ActivityAssessment;
  reportPath: string;
  evidencePath: string;
}

export async function assessActivity(
  app: App,
  settings: AssessmentSettings,
  record: ActivityRecord,
  progress: ProgressSink,
): Promise<AssessmentResult> {
  progress.status("收集行动笔记、观察、转写与图像说明…");
  const framework = await readFramework(app, settings);
  const photos = await collectPhotoPaths(app, record);
  const blocks = await collectBlocks(app, record);
  if (!blocks.length) {
    throw new Error("没有可读的素材。先在 观察/ 写导师复盘，或把录音/图片放进 素材/ 并运行「AI 整理素材」。");
  }

  const context = buildContext(blocks, settings.maxContextChars);
  if (context.omitted) progress.log(`有 ${context.omitted} 个来源因上下文预算被省略。`);
  if (context.truncated) progress.log("素材较长，已做中间省略；报告引用时请注意核对原文。");
  progress.log(`本次使用 ${blocks.length} 个来源，上下文约 ${context.used} 字。`);

  progress.status("调用 AI，对照教学目标整理证据…");
  const messages = buildActivityMessages({
    meta: record.meta,
    framework,
    context: context.text,
    contextTruncated: context.truncated,
    photos,
  });
  const raw = await chatJson(settings, messages);
  const assessment = normalizeActivityAssessment(raw, record.meta, settings.aiModel);
  const photoSet = new Set(photos);
  for (const student of assessment.students) {
    for (const evidence of student.evidence) {
      if (evidence.photo && !photoSet.has(evidence.photo)) delete evidence.photo;
    }
  }
  assessment.evidence_photos = photos.slice(0, 12);

  progress.status("写入证据清单与活动成长报告…");
  const evidenceJsonPath = `${record.folder}/${SUBFOLDERS.evidence}/${"证据.json"}`;
  const evidenceNotePath = `${record.folder}/${SUBFOLDERS.evidence}/${"证据.md"}`;
  const reportPath = `${record.folder}/${SUBFOLDERS.reports}/${activityReportFileName(record.meta)}`;
  await writeText(app, evidenceJsonPath, `${JSON.stringify(assessment, null, 2)}\n`);
  await writeText(app, evidenceNotePath, renderEvidenceNote(assessment));
  const internalMarkdown = renderActivityReport(assessment);
  await writeText(app, reportPath, internalMarkdown);
  try {
    const externalName = reportPath.split("/").pop()?.replace(/\.md$/i, "") + "_对外.md";
    await writeExternalReport(
      app,
      settings,
      internalMarkdown,
      `${record.folder}/${SUBFOLDERS.reports}`,
      record.meta.participants,
      externalName,
    );
  } catch (error) {
    progress.log(`对外版生成失败：${error instanceof Error ? error.message : String(error)}`);
  }
  await updateActivityStatus(app, record.folder, "已生成报告");

  progress.status(`报告已生成：${reportPath}`);
  return { assessment, reportPath, evidencePath: evidenceNotePath };
}
