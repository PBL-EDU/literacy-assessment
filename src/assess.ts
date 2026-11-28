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
  safeFilePart,
} from "./core";
import { buildActivityMessages } from "./prompt";
import { chatJson } from "./ai";
import { renderActivityReport, renderEvidenceNote } from "./report";
import { pathExists, readText, updateActivityStatus, walkFiles, writeText } from "./vault";
import type { ProgressSink } from "./organize";
import { buildFrameworkContext, primaryFrameworkId, resolveFrameworkRefs } from "./framework";
import { verifyInstalledBundle } from "./frameworkBundle";
import { readProfile } from "./profile";
import { markReportPending } from "./review";

export async function readFramework(app: App, settings: AssessmentSettings): Promise<string> {
  const path = resolveFrameworkPath(settings);
  if (!(await pathExists(app, path))) return "";
  try {
    return (await readText(app, path)).slice(0, 20_000);
  } catch {
    return "";
  }
}

function renderTeachingFeedback(record: ActivityRecord, assessment: ActivityAssessment): string {
  const feedback = assessment.teaching_feedback;
  const quality = assessment.quality_summary;
  const lines: string[] = [];
  lines.push("---");
  lines.push("type: teaching-feedback");
  lines.push(`action_id: ${record.meta.action_id}`);
  lines.push(`generated_at: ${new Date().toISOString()}`);
  lines.push("---");
  lines.push("");
  lines.push(`# 教学反馈：${record.meta.title}`);
  lines.push("");
  lines.push("> 这份反馈给本地导师，用于改进课堂/行动带领和下一次证据收集；不是学生评价。");
  lines.push("");
  if (!feedback) {
    lines.push("## 待补充");
    lines.push("");
    lines.push("本次 AI 未生成教学反馈，请导师根据行动记录补充。");
    return lines.join("\n");
  }
  lines.push("## 一、这次行动/课堂的带领");
  lines.push("");
  for (const item of feedback.leading) lines.push(`- ${item}`);
  if (!feedback.leading.length) lines.push("- 暂无建议。");
  lines.push("");
  lines.push("## 二、证据与信息收集");
  lines.push("");
  for (const item of feedback.evidence_collection) lines.push(`- ${item}`);
  if (!feedback.evidence_collection.length) lines.push("- 暂无建议。");
  lines.push("");
  lines.push("## 三、下一次观察");
  lines.push("");
  for (const item of feedback.next_observation) lines.push(`- ${item}`);
  if (!feedback.next_observation.length) lines.push("- 暂无建议。");
  if (quality) {
    lines.push("");
    lines.push("## 四、质量摘要");
    lines.push("");
    lines.push(`- 使用来源：${quality.source_count}`);
    lines.push(`- 覆盖目标：${quality.goal_count}`);
    lines.push(`- 低置信度证据：${quality.low_confidence_count}`);
    lines.push(`- 矛盾：${quality.contradiction_count}`);
    if (quality.gaps.length) lines.push(`- 证据缺口：${quality.gaps.join("；")}`);
  }
  lines.push("");
  return lines.join("\n");
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
  const frameworkRefs = await resolveFrameworkRefs(app, settings, record);
  const frameworkContext = await buildFrameworkContext(app, settings, frameworkRefs, record.meta.targets);
  const missing = frameworkRefs.filter(
    (ref) => !frameworkContext.definitions.some((item) => item.id === ref.id),
  );
  if (missing.length) {
    throw new Error(`找不到框架：${missing.map((ref) => ref.id).join("、")}。请检查项目框架绑定或设置页框架库。`);
  }
  const invalid = frameworkContext.definitions.filter((item) => item.errors.length);
  if (invalid.length) {
    throw new Error(
      `框架量表不完整：${invalid.map((item) => `${item.id}：${item.errors.join("；")}`).join(" / ")}。请先补全量表表格。`,
    );
  }
  for (const definition of frameworkContext.definitions) {
    if (definition.mandatory && definition.orgId) {
      const verification = await verifyInstalledBundle(app, settings, definition.id, definition.orgId);
      if (verification && !verification.ok) {
        throw new Error(`组织框架校验失败：${verification.reason}`);
      }
    }
  }
  const framework = frameworkContext.text || (await readFramework(app, settings));
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
  assessment.framework_refs = frameworkRefs;
  assessment.targets = record.meta.targets;
  assessment.student_targets = record.meta.student_targets;
  assessment.framework_versions = frameworkContext.versions;
  assessment.framework_hashes = frameworkContext.hashes;
  const primaryId = primaryFrameworkId(frameworkRefs);
  const primaryName = frameworkContext.definitions.find((item) => item.id === primaryId)?.name || primaryId;
  if (assessment.level_proposals) {
    const profiles = new Map<string, Awaited<ReturnType<typeof readProfile>>>();
    for (const proposal of assessment.level_proposals) {
      if (!profiles.has(proposal.student)) {
        profiles.set(proposal.student, await readProfile(app, settings, proposal.student));
      }
    }
    assessment.level_proposals = assessment.level_proposals.map((proposal) => {
      const profile = profiles.get(proposal.student);
      const current = profile?.levels.find(
        (item) => item.goal === proposal.goal || item.goal.includes(proposal.goal),
      );
      return {
        ...proposal,
        framework_id: proposal.framework_id || primaryId,
        framework_name: proposal.framework_name || primaryName,
        current_level: current?.level || proposal.current_level,
      };
    });
  }

  progress.status("写入证据清单与活动成长报告…");
  const evidenceJsonPath = `${record.folder}/${SUBFOLDERS.evidence}/${"证据.json"}`;
  const evidenceNotePath = `${record.folder}/${SUBFOLDERS.evidence}/${"证据.md"}`;
  const reportPath = `${record.folder}/${SUBFOLDERS.reports}/${activityReportFileName(record.meta)}`;
  await writeText(app, evidenceJsonPath, `${JSON.stringify(assessment, null, 2)}\n`);
  await writeText(app, evidenceNotePath, renderEvidenceNote(assessment));
  const internalMarkdown = renderActivityReport(assessment);
  await writeText(app, reportPath, internalMarkdown);
  const feedbackPath = `${record.folder}/${SUBFOLDERS.reports}/教学反馈_${safeFilePart(record.meta.title)}.md`;
  await writeText(app, feedbackPath, renderTeachingFeedback(record, assessment));
  await markReportPending(app, reportPath, "activity", {
    quality: assessment.quality_summary,
    proposals: assessment.level_proposals,
    feedback: assessment.teaching_feedback,
    actionTitle: record.meta.title,
    projectTitle: record.meta.series,
  });
  await updateActivityStatus(app, record.folder, "待审核");

  progress.status(`报告已生成，待本地导师审核：${reportPath}`);
  return { assessment, reportPath, evidencePath: evidenceNotePath };
}
