/**
 * 阶段性报告：把一个学员跨活动的证据汇总，对照素养框架生成阶段报告。
 */
import type { App } from "obsidian";
import type {
  ActivityAssessment,
  ActivityRecord,
  AssessmentSettings,
  ContextBlock,
  OverviewAssessment,
  StageAssessment,
} from "./types";
import { FOLDERS, SUBFOLDERS } from "./types";
import {
  asNumber,
  asRecord,
  asString,
  asStringArray,
  buildContext,
  classifyFile,
  normalizeOverviewAssessment,
  normalizeStageAssessment,
  sanitizeName,
  studentRoot,
  todayISO,
  unique,
} from "./core";
import { buildOverviewMessages, buildSeriesMessages, buildStageMessages } from "./prompt";
import { chatJson } from "./ai";
import { renderStageReport } from "./report";
import {
  ensureFolder,
  findActivityReportPath,
  findStudentNote,
  listActivities,
  listFolders,
  listSeriesRecords,
  pathExists,
  readText,
  walkFiles,
  writeText,
} from "./vault";
import { readFramework } from "./assess";
import { writeExternalReport } from "./external";
import { renderOverviewReport } from "./report";
import type { ProgressSink } from "./organize";

export async function listStudents(app: App, settings: AssessmentSettings): Promise<string[]> {
  const folders = await listFolders(app, studentRoot(settings));
  const fromFolders = folders.map((folder) => folder.split("/").pop() ?? "").filter(Boolean);
  const activities = await listActivities(app, settings);
  const fromActivities = activities.flatMap((activity) => activity.meta.participants);
  return unique([...fromFolders, ...fromActivities]).sort((a, b) => a.localeCompare(b, "zh"));
}

function activityEvidenceText(assessment: ActivityAssessment, student: string): string {
  const studentData = assessment.students.find((s) => s.student === student);
  const goals = assessment.goal_analysis
    .map((g) => `- ${g.goal}（${g.coverage}）：${g.comment}`)
    .join("\n");
  const evidence = (studentData?.evidence ?? [])
    .map((e) => `- [${e.level}] ${e.dimension} / ${e.goal}：${e.quote}（来源：${e.source}；${e.origin}）`)
    .join("\n");
  return [
    `活动：${assessment.activity_title}（${assessment.date}，${assessment.activity_type}）`,
    `概述：${assessment.overview}`,
    "目标覆盖：",
    goals || "（没有记录）",
    `该学员概述：${studentData?.summary ?? "（没有该学员的记录）"}`,
    "该学员证据：",
    evidence || "（没有可核验证据）",
    `导师建议：${assessment.mentor_suggestions.join("；") || "（无）"}`,
  ].join("\n");
}

async function loadActivityBlock(
  app: App,
  record: ActivityRecord,
  student: string,
): Promise<ContextBlock | null> {
  const jsonPath = `${record.folder}/${SUBFOLDERS.evidence}/证据.json`;
  if (await pathExists(app, jsonPath)) {
    try {
      const raw = asRecord(JSON.parse(await readText(app, jsonPath)));
      const assessment: ActivityAssessment = {
        activity_id: asString(raw.activity_id),
        activity_title: asString(raw.activity_title, record.meta.title),
        activity_type: asString(raw.activity_type, record.meta.type),
        date: asString(raw.date, record.meta.date),
        mentor: asString(raw.mentor, record.meta.mentor),
        generated_at: asString(raw.generated_at),
        model: asString(raw.model),
        overview: asString(raw.overview),
        goal_analysis: Array.isArray(raw.goal_analysis)
          ? raw.goal_analysis.map((g) => {
              const item = asRecord(g);
              return { goal: asString(item.goal), coverage: asString(item.coverage), comment: asString(item.comment) };
            })
          : [],
        students: Array.isArray(raw.students)
          ? raw.students.map((s) => {
              const item = asRecord(s);
              return {
                student: asString(item.student),
                summary: asString(item.summary),
                evidence: [],
                strengths: asStringArray(item.strengths),
                next_steps: asStringArray(item.next_steps),
                missing_evidence: asStringArray(item.missing_evidence),
              };
            })
          : [],
        mentor_suggestions: asStringArray(raw.mentor_suggestions),
        missing_evidence: asStringArray(raw.missing_evidence),
        disclaimer: asString(raw.disclaimer),
      };
      // 证据单独读，避免上面的结构被过度简化
      if (Array.isArray(raw.students)) {
        for (const [index, studentRaw] of raw.students.entries()) {
          const item = asRecord(studentRaw);
          const target = assessment.students[index];
          if (!target || !Array.isArray(item.evidence)) continue;
          target.evidence = item.evidence.map((e) => {
            const ev = asRecord(e);
            return {
              student: asString(ev.student, asString(item.student)),
              goal: asString(ev.goal),
              dimension: asString(ev.dimension),
              level: asString(ev.level, "未判断"),
              quote: asString(ev.quote),
              source: asString(ev.source),
              confidence: asNumber(ev.confidence, 0.5),
              origin: asString(ev.origin) === "推断" ? "推断" : "原文",
              note: asString(ev.note) || undefined,
            };
          });
        }
      }
      return { label: `${record.meta.date}_${record.meta.title}`, text: activityEvidenceText(assessment, student), priority: 10 };
    } catch {
      /* 退回读报告 */
    }
  }
  const reportPath = await findActivityReportPath(app, record);
  if (reportPath) {
    return {
      label: `${record.meta.date}_${record.meta.title}`,
      text: await readText(app, reportPath),
      priority: 10,
    };
  }
  return null;
}

export interface StageResult {
  assessment: StageAssessment;
  reportPath: string;
  externalPath?: string;
}

export interface OverviewResult {
  assessment: OverviewAssessment;
  reportPath: string;
  externalPath?: string;
}

async function collectOverviewPhotos(app: App, activities: ActivityRecord[]): Promise<string[]> {
  const photos: string[] = [];
  for (const activity of activities) {
    for (const file of await walkFiles(app, `${activity.folder}/${SUBFOLDERS.materials}`)) {
      if (classifyFile(file) === "image") photos.push(file);
    }
  }
  return unique(photos).slice(0, 20);
}

async function collectOverviewBlocks(
  app: App,
  activities: ActivityRecord[],
  participants: string[],
  progress: ProgressSink,
): Promise<ContextBlock[]> {
  const blocks: ContextBlock[] = [];
  for (const activity of activities) {
    if (progress.cancelled()) throw new Error("用户中止了总报告。");
    for (const student of participants) {
      const block = await loadActivityBlock(app, activity, student);
      if (block) blocks.push({ ...block, label: `${activity.meta.date}_${activity.meta.title}_${student}` });
    }
  }
  return blocks;
}

export async function generateProjectOverviewReport(
  app: App,
  settings: AssessmentSettings,
  projectName: string,
  period: string,
  progress: ProgressSink,
): Promise<OverviewResult> {
  const activities = (await listActivities(app, settings))
    .filter((activity) => activity.meta.series === projectName)
    .sort((a, b) => (a.meta.date || "").localeCompare(b.meta.date || ""));
  if (!activities.length) throw new Error(`「${projectName}」还没有行动记录。`);
  const participants = unique(activities.flatMap((activity) => activity.meta.participants));
  if (!participants.length) throw new Error("这个项目还没有参与同学。");

  progress.status(`汇总「${projectName}」的 ${activities.length} 次行动、${participants.length} 位同学…`);
  const blocks = await collectOverviewBlocks(app, activities, participants, progress);
  if (!blocks.length) throw new Error("项目内还没有行动报告或证据，请先生成行动报告。");

  const framework = await readFramework(app, settings);
  const context = buildContext(blocks, settings.maxContextChars);
  const periodLabel = period.trim() || projectName;
  const messages = buildOverviewMessages({
    kind: "project_overview",
    scope: projectName,
    period: periodLabel,
    participants,
    actionTitles: activities.map((activity) => `${activity.meta.title}（${activity.meta.date}）`),
    framework,
    context: context.text,
  });
  progress.status("调用 AI 汇总项目总报告…");
  const raw = await chatJson(settings, messages);
  const assessment = normalizeOverviewAssessment(
    raw,
    "project_overview",
    projectName,
    periodLabel,
    settings.aiModel,
    participants,
    activities.length,
  );
  assessment.evidence_photos = await collectOverviewPhotos(app, activities);

  const series = (await listSeriesRecords(app, settings)).find((item) => item.meta.title === projectName);
  const folder = `${series?.folder ?? `${settings.dataRoot}/${FOLDERS.series}/${sanitizeName(projectName)}`}/报告`;
  await ensureFolder(app, folder);
  const base = `项目总报告_${sanitizeName(periodLabel)}`;
  const reportPath = `${folder}/${base}.md`;
  const markdown = renderOverviewReport(assessment);
  await writeText(app, reportPath, markdown);
  await writeText(app, `${folder}/${base}.json`, `${JSON.stringify(assessment, null, 2)}\n`);
  let externalPath: string | undefined;
  try {
    externalPath = await writeExternalReport(
      app,
      settings,
      markdown,
      folder,
      participants,
      `${base}_对外.md`,
    );
  } catch (error) {
    progress.log(`对外版生成失败：${error instanceof Error ? error.message : String(error)}`);
  }
  progress.status(`项目总报告已生成：${reportPath}`);
  return { assessment, reportPath, externalPath };
}

export async function generateTermOverviewReport(
  app: App,
  settings: AssessmentSettings,
  period: string,
  progress: ProgressSink,
): Promise<OverviewResult> {
  const activities = (await listActivities(app, settings)).sort((a, b) =>
    (a.meta.date || "").localeCompare(b.meta.date || ""),
  );
  if (!activities.length) throw new Error("还没有任何行动记录。");
  const participants = unique(activities.flatMap((activity) => activity.meta.participants));
  if (!participants.length) throw new Error("还没有参与同学。");

  progress.status(`汇总 ${activities.length} 次行动、${participants.length} 位同学的${period}…`);
  const blocks = await collectOverviewBlocks(app, activities, participants, progress);
  if (!blocks.length) throw new Error("还没有行动报告或证据，请先生成行动报告。");

  const framework = await readFramework(app, settings);
  const context = buildContext(blocks, settings.maxContextChars);
  const messages = buildOverviewMessages({
    kind: "term_overview",
    scope: period,
    period,
    participants,
    actionTitles: activities.map((activity) => `${activity.meta.title}（${activity.meta.date}）`),
    framework,
    context: context.text,
  });
  progress.status("调用 AI 汇总学期/学年总报告…");
  const raw = await chatJson(settings, messages);
  const assessment = normalizeOverviewAssessment(
    raw,
    "term_overview",
    period,
    period,
    settings.aiModel,
    participants,
    activities.length,
  );
  assessment.evidence_photos = await collectOverviewPhotos(app, activities);

  const folder = `${settings.dataRoot}/${FOLDERS.reports}`;
  await ensureFolder(app, folder);
  const base = `学期总报告_${sanitizeName(period)}`;
  const reportPath = `${folder}/${base}.md`;
  const markdown = renderOverviewReport(assessment);
  await writeText(app, reportPath, markdown);
  await writeText(app, `${folder}/${base}.json`, `${JSON.stringify(assessment, null, 2)}\n`);
  let externalPath: string | undefined;
  try {
    externalPath = await writeExternalReport(
      app,
      settings,
      markdown,
      folder,
      participants,
      `${base}_对外.md`,
    );
  } catch (error) {
    progress.log(`对外版生成失败：${error instanceof Error ? error.message : String(error)}`);
  }
  progress.status(`学期/学年总报告已生成：${reportPath}`);
  return { assessment, reportPath, externalPath };
}

export async function generateStageReport(
  app: App,
  settings: AssessmentSettings,
  student: string,
  period: string,
  progress: ProgressSink,
): Promise<StageResult> {
  progress.status(`汇总 ${student} 的活动记录…`);
  const activities = (await listActivities(app, settings)).filter((activity) =>
    activity.meta.participants.some((name) => name === student),
  );
  if (!activities.length) {
    throw new Error(`没有找到 ${student} 的活动记录。先确认行动笔记里的 participants 写了该学员。`);
  }
  activities.sort((a, b) => (a.meta.date || "").localeCompare(b.meta.date || ""));

  const blocks: ContextBlock[] = [];
  for (const activity of activities) {
    if (progress.cancelled()) throw new Error("用户中止了阶段报告。");
    const block = await loadActivityBlock(app, activity, student);
    if (block) blocks.push(block);
  }
  if (!blocks.length) {
    throw new Error("这些活动还没有生成活动报告或证据，先逐个生成活动成长报告。");
  }

  const framework = await readFramework(app, settings);
  const context = buildContext(blocks, settings.maxContextChars);
  if (context.truncated) progress.log("多次活动的材料较长，已做中间省略。");

  const start = activities[0]?.meta.date ?? "";
  const end = activities[activities.length - 1]?.meta.date ?? "";
  const fallbackPeriod = start && end ? `${start} 至 ${end}` : todayISO();
  const label = period.trim() || fallbackPeriod;

  progress.status(`调用 AI 汇总 ${blocks.length} 次活动…`);
  const messages = buildStageMessages({
    student,
    period: label,
    framework,
    context: context.text,
    activityTitles: activities.map((a) => `${a.meta.title}（${a.meta.date}）`),
  });
  const raw = await chatJson(settings, messages);
  const assessment = normalizeStageAssessment(raw, student, label, settings.aiModel);
  assessment.report_kind = "stage";
  assessment.report_title = "阶段性成长报告";

  progress.status("写入阶段报告…");
  const folder = `${studentRoot(settings)}/${sanitizeName(student)}`;
  await ensureFolder(app, folder);
  const fileName = `阶段成长报告_${sanitizeName(label.replace(/\s+/g, ""))}.md`;
  const reportPath = `${folder}/${fileName}`;
  const internalMarkdown = renderStageReport(assessment);
  await writeText(app, reportPath, internalMarkdown);
  await writeText(app, `${folder}/阶段成长报告_${sanitizeName(label.replace(/\s+/g, ""))}.json`, `${JSON.stringify(assessment, null, 2)}\n`);
  let externalPath: string | undefined;
  try {
    externalPath = await writeExternalReport(
      app,
      settings,
      internalMarkdown,
      folder,
      [student],
      fileName.replace(/\.md$/i, "_对外.md"),
    );
  } catch (error) {
    progress.log(`对外版生成失败：${error instanceof Error ? error.message : String(error)}`);
  }

  const profilePath = await findStudentNote(app, folder);
  if (profilePath) {
    const profile = await readText(app, profilePath);
    const link = `[[阶段成长报告_${sanitizeName(label.replace(/\s+/g, ""))}]]`;
    if (!profile.includes(link)) {
      await writeText(app, profilePath, `${profile.trimEnd()}\n- ${link}（${label}）\n`);
    }
  }

  progress.status(`阶段报告已生成：${reportPath}`);
  return { assessment, reportPath, externalPath };
}

export async function generateSeriesReport(
  app: App,
  settings: AssessmentSettings,
  seriesName: string,
  student: string,
  progress: ProgressSink,
): Promise<StageResult> {
  progress.status(`汇总「${seriesName}」中的 ${student} 行动记录…`);
  const activities = (await listActivities(app, settings))
    .filter(
      (activity) =>
        activity.meta.series === seriesName && activity.meta.participants.some((name) => name === student),
    )
    .sort((a, b) => (a.meta.date || "").localeCompare(b.meta.date || ""));
  if (!activities.length) {
    throw new Error(`「${seriesName}」里没有 ${student} 的行动记录。先确认行动笔记的 series 和 participants。`);
  }

  const blocks: ContextBlock[] = [];
  for (const activity of activities) {
    if (progress.cancelled()) throw new Error("用户中止了项目报告。");
    const block = await loadActivityBlock(app, activity, student);
    if (block) blocks.push(block);
  }
  if (!blocks.length) {
    throw new Error("项目内还没有活动报告或证据，先逐个生成活动成长报告。");
  }

  const framework = await readFramework(app, settings);
  const context = buildContext(blocks, settings.maxContextChars);
  if (context.truncated) progress.log("项目材料较长，已做中间省略。");

  const label = seriesName;
  progress.status(`调用 AI 汇总 ${blocks.length} 次项目行动…`);
  const messages = buildSeriesMessages({
    series: seriesName,
    student,
    framework,
    context: context.text,
    actionTitles: activities.map((a) => `${a.meta.title}（${a.meta.date}）`),
  });
  const raw = await chatJson(settings, messages);
  const assessment = normalizeStageAssessment(raw, student, label, settings.aiModel);
  assessment.report_kind = "series";
  assessment.report_title = "项目成长报告";

  progress.status("写入项目报告…");
  const folder = `${studentRoot(settings)}/${sanitizeName(student)}`;
  await ensureFolder(app, folder);
  const base = `项目成长报告_${sanitizeName(seriesName)}`;
  const reportPath = `${folder}/${base}.md`;
  const internalMarkdown = renderStageReport(assessment);
  await writeText(app, reportPath, internalMarkdown);
  await writeText(app, `${folder}/${base}.json`, `${JSON.stringify(assessment, null, 2)}\n`);
  let externalPath: string | undefined;
  try {
    externalPath = await writeExternalReport(
      app,
      settings,
      internalMarkdown,
      folder,
      [student],
      `${base}_对外.md`,
    );
  } catch (error) {
    progress.log(`对外版生成失败：${error instanceof Error ? error.message : String(error)}`);
  }

  const profilePath = await findStudentNote(app, folder);
  if (profilePath) {
    const profile = await readText(app, profilePath);
    const link = `[[${base}]]`;
    if (!profile.includes(link)) {
      await writeText(app, profilePath, `${profile.trimEnd()}\n- ${link}（${seriesName}）\n`);
    }
  }

  progress.status(`项目报告已生成：${reportPath}`);
  return { assessment, reportPath, externalPath };
}
