/**
 * Obsidian 数据层：目录、行动笔记、学员档案、素材枚举。
 */
import { App, FileSystemAdapter, TFile, normalizePath, parseYaml } from "obsidian";
import type {
  ActivityMeta,
  ActivityRecord,
  ActivityType,
  ArtifactInfo,
  AssessmentSettings,
  GroupMeta,
  GroupRecord,
  NewActivityInput,
  NewGroupInput,
  NewSeriesInput,
  SeriesMeta,
  SeriesRecord,
  StudentProfile,
} from "./types";
import { ACTIVITY_NOTE, FOLDERS, GROUP_NOTE, SERIES_NOTE, STUDENT_NOTE, SUBFOLDERS } from "./types";
import {
  activityFolderName,
  activityReportFileName,
  asRecord,
  asString,
  classifyFile,
  groupRoot,
  normalizeActivityMeta,
  normalizeActivityType,
  normalizeGroupMeta,
  normalizeSeriesMeta,
  nowISO,
  parseGoals,
  parseParticipants,
  resolveFrameworkPath,
  sanitizeName,
  seriesActionsFolder,
  seriesIdFor,
  seriesRoot,
  seriesRoots,
  splitFrontmatter,
  stemOf,
  studentRoot,
  todayISO,
  unique,
} from "./core";

export function yamlValue(value: string): string {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function parentOf(path: string): string {
  const parts = normalizePath(path).split("/");
  parts.pop();
  return parts.join("/");
}

export async function pathExists(app: App, path: string): Promise<boolean> {
  return app.vault.adapter.exists(normalizePath(path));
}

export async function ensureFolder(app: App, path: string): Promise<void> {
  const normalized = normalizePath(path);
  if (!normalized || normalized === "/") return;
  const parts = normalized.split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (await app.vault.adapter.exists(current)) continue;
    try {
      await app.vault.createFolder(current);
    } catch (error) {
      if (!(await app.vault.adapter.exists(current))) throw error;
    }
  }
}

export async function readText(app: App, path: string): Promise<string> {
  return app.vault.adapter.read(normalizePath(path));
}

export async function writeText(app: App, path: string, content: string): Promise<void> {
  const normalized = normalizePath(path);
  await ensureFolder(app, parentOf(normalized));
  const existing = app.vault.getAbstractFileByPath(normalized);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
    return;
  }
  if (existing) throw new Error(`路径已存在但不是文件：${normalized}`);
  await app.vault.create(normalized, content);
}

export async function writeBinary(app: App, path: string, data: ArrayBuffer): Promise<void> {
  const normalized = normalizePath(path);
  await ensureFolder(app, parentOf(normalized));
  const existing = app.vault.getAbstractFileByPath(normalized);
  if (existing instanceof TFile) {
    await app.vault.modifyBinary(existing, data);
    return;
  }
  if (existing) throw new Error(`路径已存在但不是文件：${normalized}`);
  await app.vault.createBinary(normalized, data);
}

type EntityKind = "action" | "series" | "group" | "student";

async function findEntityNote(app: App, folder: string, kind: EntityKind): Promise<string | null> {
  const normalized = normalizePath(folder);
  if (await app.vault.adapter.exists(normalized)) {
    const listing = await app.vault.adapter.list(normalized);
    for (const file of listing.files) {
      if (!/\.md$/i.test(file) || parentOf(file) !== normalized) continue;
      try {
        const markdown = await readText(app, file);
        const { frontmatter } = splitFrontmatter(markdown);
        let raw: Record<string, unknown> = {};
        if (frontmatter.trim()) raw = asRecord(parseYaml(frontmatter));
        const type = typeof raw.type === "string" ? raw.type : "";
        const matched =
          kind === "action"
            ? Boolean(raw.action_id) || Boolean(raw.start_time) || ["项目", "课程", "课堂", "活动", "行动", "其他"].includes(type)
            : kind === "series"
              ? type === "series" || Boolean(raw.series_id)
              : kind === "group"
                ? type === "group" || Boolean(raw.group_id)
                : type === "student";
        if (matched) return file;
      } catch {
        /* 跳过读不出来的旧文件 */
      }
    }
  }
  const fallback =
    kind === "action"
      ? `${normalized}/${ACTIVITY_NOTE}`
      : kind === "series"
        ? `${normalized}/${SERIES_NOTE}`
        : kind === "group"
          ? `${normalized}/${GROUP_NOTE}`
          : `${normalized}/${STUDENT_NOTE}`;
  return (await pathExists(app, fallback)) ? fallback : null;
}

export async function findStudentNote(app: App, folder: string): Promise<string | null> {
  return findEntityNote(app, folder, "student");
}

async function uniqueEntityNoteName(
  app: App,
  desired: string,
  suffix?: string,
  ignorePath?: string,
): Promise<string> {
  const base = sanitizeName(desired).trim() || "未命名";
  const used = new Set(
    app.vault
      .getMarkdownFiles()
      .filter((file) => file.path !== ignorePath)
      .map((file) => file.basename.toLowerCase()),
  );
  let candidate = base;
  let index = 2;
  while (used.has(candidate.toLowerCase())) {
    if (index === 2 && suffix) candidate = `${base}（${sanitizeName(suffix)}）`;
    else candidate = `${base}（${index}）`;
    index++;
  }
  return candidate;
}

export async function addExternalId(app: App, folder: string, externalId: string): Promise<void> {
  const notePath = await findEntityNote(app, folder, "action");
  if (!notePath) return;
  const file = app.vault.getAbstractFileByPath(normalizePath(notePath));
  if (!(file instanceof TFile)) return;
  await app.fileManager.processFrontMatter(file, (frontmatter) => {
    const existing = Array.isArray(frontmatter.getnote_ids)
      ? frontmatter.getnote_ids.filter((id: unknown): id is string => typeof id === "string")
      : [];
    if (!existing.includes(externalId)) existing.push(externalId);
    frontmatter.getnote_ids = existing;
    frontmatter.updated = nowISO();
  });
}

export async function listFolders(app: App, path: string): Promise<string[]> {
  const normalized = normalizePath(path);
  if (!(await app.vault.adapter.exists(normalized))) return [];
  const listing = await app.vault.adapter.list(normalized);
  return listing.folders;
}

export async function walkFiles(app: App, root: string): Promise<string[]> {
  const normalized = normalizePath(root);
  if (!(await app.vault.adapter.exists(normalized))) return [];
  const out: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    const listing = await app.vault.adapter.list(dir);
    for (const file of listing.files) out.push(file);
    for (const folder of listing.folders) await visit(folder);
  };
  await visit(normalized);
  return out;
}

export function wikiLink(path: string, label: string): string {
  const target = normalizePath(path).replace(/\.md$/i, "").replace(/\r?\n/g, " ");
  const alias = label.replace(/\[|\]|\|/g, " ").trim() || target;
  return `[[${target}|${alias}]]`;
}

const LINK_BLOCK_START = "<!-- literacy-links:start -->";
const LINK_BLOCK_END = "<!-- literacy-links:end -->";

export async function upsertLinkBlock(app: App, path: string, block: string): Promise<void> {
  if (!(await pathExists(app, path))) return;
  const markdown = await readText(app, path);
  const section = `${LINK_BLOCK_START}\n${block.trim()}\n${LINK_BLOCK_END}`;
  const pattern = /<!-- literacy-links:start -->[\s\S]*?<!-- literacy-links:end -->/;
  const next = pattern.test(markdown)
    ? markdown.replace(pattern, section)
    : `${markdown.trimEnd()}\n\n${section}\n`;
  if (next !== markdown) await writeText(app, path, next);
}

export function getFullPath(app: App, path: string): string {
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) {
    throw new Error("当前不是桌面端文件系统，无法读取本地素材路径。");
  }
  return adapter.getFullPath(normalizePath(path));
}

export async function openFile(app: App, path: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(normalizePath(path));
  if (file instanceof TFile) {
    await app.workspace.getLeaf(false).openFile(file);
  }
}

export async function ensureDataStructure(app: App, settings: AssessmentSettings): Promise<void> {
  const root = normalizePath(settings.dataRoot);
  // 新库使用 01_项目；不自动创建旧 01_系列。
  for (const sub of [
    FOLDERS.framework,
    FOLDERS.series,
    FOLDERS.groups,
    FOLDERS.students,
    FOLDERS.templates,
    FOLDERS.imports,
    FOLDERS.reports,
  ]) {
    await ensureFolder(app, `${root}/${sub}`);
  }
  const frameworkPath = normalizePath(resolveFrameworkPath(settings));
  if (!(await pathExists(app, frameworkPath))) {
    await writeText(app, frameworkPath, DEFAULT_FRAMEWORK);
  }
  const templatePath = `${root}/${FOLDERS.templates}/活动报告模板.md`;
  if (!(await pathExists(app, templatePath))) {
    await writeText(app, templatePath, ACTIVITY_REPORT_TEMPLATE);
  }
}

export function readActivityFromMarkdown(
  markdown: string,
  folder: string,
  notePath = `${folder}/${ACTIVITY_NOTE}`,
): ActivityRecord {
  const { frontmatter, body } = splitFrontmatter(markdown);
  let raw: Record<string, unknown> = {};
  if (frontmatter.trim()) {
    try {
      raw = asRecord(parseYaml(frontmatter));
    } catch {
      raw = {};
    }
  }
  return { folder, notePath, meta: normalizeActivityMeta(raw, folder), body };
}

export async function readActivity(app: App, folder: string): Promise<ActivityRecord | null> {
  const notePath = await findEntityNote(app, folder, "action");
  if (!notePath) return null;
  const markdown = await readText(app, notePath);
  return readActivityFromMarkdown(markdown, folder, notePath);
}

export async function readSeries(app: App, folder: string): Promise<SeriesRecord | null> {
  const notePath = await findEntityNote(app, folder, "series");
  if (!notePath) return null;
  const markdown = await readText(app, notePath);
  const { frontmatter, body } = splitFrontmatter(markdown);
  let raw: Record<string, unknown> = {};
  if (frontmatter.trim()) {
    try {
      raw = asRecord(parseYaml(frontmatter));
    } catch {
      raw = {};
    }
  }
  return { folder, notePath, meta: normalizeSeriesMeta(raw, folder), body };
}

export async function listSeriesRecords(app: App, settings: AssessmentSettings): Promise<SeriesRecord[]> {
  const records: SeriesRecord[] = [];
  const seen = new Set<string>();
  for (const root of seriesRoots(settings)) {
    for (const folder of await listFolders(app, root)) {
      const record = await readSeries(app, folder);
      if (!record || seen.has(record.meta.title)) continue;
      seen.add(record.meta.title);
      records.push(record);
    }
  }
  records.sort((a, b) => a.meta.title.localeCompare(b.meta.title, "zh"));
  return records;
}

export async function createSeries(
  app: App,
  settings: AssessmentSettings,
  input: NewSeriesInput,
): Promise<SeriesRecord> {
  const root = seriesRoot(settings);
  await ensureFolder(app, root);
  const title = input.title.trim() || "未命名系列";
  const folder = await uniqueFolder(app, root, sanitizeName(title));
  await ensureFolder(app, seriesActionsFolder(folder));
  const meta: SeriesMeta = {
    series_id: seriesIdFor(title),
    title,
    type: input.type,
    mentor: input.mentor.trim(),
    description: input.description.trim(),
    goals: parseGoals(input.goalsText),
    created_at: nowISO(),
    status: "进行中",
  };
  const noteName = await uniqueEntityNoteName(app, title, "系列");
  const notePath = `${folder}/${noteName}.md`;
  await writeText(app, notePath, renderSeriesNote(meta));
  return { folder, notePath, meta, body: renderSeriesNote(meta) };
}

export async function readGroup(app: App, folder: string): Promise<GroupRecord | null> {
  const notePath = await findEntityNote(app, folder, "group");
  if (!notePath) return null;
  const markdown = await readText(app, notePath);
  const { frontmatter, body } = splitFrontmatter(markdown);
  let raw: Record<string, unknown> = {};
  if (frontmatter.trim()) {
    try {
      raw = asRecord(parseYaml(frontmatter));
    } catch {
      raw = {};
    }
  }
  return { folder, notePath, meta: normalizeGroupMeta(raw, folder), body };
}

export async function listGroups(app: App, settings: AssessmentSettings): Promise<GroupRecord[]> {
  const folders = await listFolders(app, groupRoot(settings));
  const records: GroupRecord[] = [];
  for (const folder of folders) {
    const record = await readGroup(app, folder);
    if (record) records.push(record);
  }
  records.sort((a, b) => a.meta.name.localeCompare(b.meta.name, "zh"));
  return records;
}

export async function createGroup(
  app: App,
  settings: AssessmentSettings,
  input: NewGroupInput,
): Promise<GroupRecord> {
  const root = groupRoot(settings);
  await ensureFolder(app, root);
  const name = input.name.trim() || "未命名小组";
  const folder = await uniqueFolder(app, root, sanitizeName(name));
  const members = parseParticipants(input.membersText);
  const meta: GroupMeta = {
    group_id: `group_${Math.random().toString(36).slice(2, 10)}`,
    name,
    mentor: input.mentor.trim(),
    members,
    series: input.series.trim(),
    description: input.description.trim(),
    created_at: nowISO(),
  };
  const noteName = await uniqueEntityNoteName(app, name, "小组");
  const notePath = `${folder}/${noteName}.md`;
  await writeText(app, notePath, renderGroupNote(meta));
  for (const member of members) await createStudentProfile(app, settings, member);
  return { folder, notePath, meta, body: renderGroupNote(meta) };
}

async function ensureSeriesFolder(
  app: App,
  settings: AssessmentSettings,
  seriesName: string,
): Promise<SeriesRecord> {
  const name = seriesName.trim() || "独立行动";
  const candidates = seriesRoots(settings).map((root) => `${root}/${sanitizeName(name)}`);
  for (const folder of candidates) {
    if (!(await pathExists(app, folder))) continue;
    const existing = await readSeries(app, folder);
    if (existing) {
      await ensureFolder(app, seriesActionsFolder(existing.folder));
      return existing;
    }
  }
  return createSeries(app, settings, {
    title: name,
    type: "项目",
    mentor: "",
    description: "由行动创建时自动生成，可补充系列信息。",
    goalsText: "",
  });
}

export async function listActivities(app: App, settings: AssessmentSettings): Promise<ActivityRecord[]> {
  const records: ActivityRecord[] = [];
  for (const root of seriesRoots(settings)) {
    const seriesFolders = await listFolders(app, root);
    for (const seriesFolder of seriesFolders) {
      const series = await readSeries(app, seriesFolder);
      for (const folder of await listFolders(app, seriesActionsFolder(seriesFolder))) {
        const record = await readActivity(app, folder);
        if (!record) continue;
        if (!record.meta.series && series) record.meta.series = series.meta.title;
        if (!record.meta.series_id && series) record.meta.series_id = series.meta.series_id;
        records.push(record);
      }
    }
  }

  // 兼容旧版 01_行动 目录（只读；新建一律进 01_项目）
  const legacyRoot = `${settings.dataRoot}/01_行动`;
  for (const folder of await listFolders(app, legacyRoot)) {
    const record = await readActivity(app, folder);
    if (!record) continue;
    if (!record.meta.series) record.meta.series = "独立行动";
    if (!record.meta.series_id) record.meta.series_id = seriesIdFor(record.meta.series);
    records.push(record);
  }

  records.sort((a, b) => {
    const dateCompare = (b.meta.date || "").localeCompare(a.meta.date || "");
    return dateCompare || a.meta.title.localeCompare(b.meta.title, "zh");
  });
  return records;
}

async function uniqueFolder(app: App, root: string, base: string): Promise<string> {
  let candidate = `${root}/${base}`;
  let index = 2;
  while (await pathExists(app, candidate)) {
    candidate = `${root}/${base}_${index}`;
    index++;
  }
  return candidate;
}

function renderSeriesNote(meta: SeriesMeta): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push("type: series");
  lines.push(`series_id: ${yamlValue(meta.series_id)}`);
  lines.push(`title: ${yamlValue(meta.title)}`);
  lines.push(`series_type: ${yamlValue(meta.type)}`);
  lines.push(`mentor: ${yamlValue(meta.mentor)}`);
  lines.push(`created_at: ${yamlValue(meta.created_at)}`);
  lines.push(`status: ${yamlValue(meta.status)}`);
  lines.push("goals:");
  for (const goal of meta.goals) lines.push(`  - ${yamlValue(goal)}`);
  if (!meta.goals.length) lines.push("  []");
  lines.push("---");
  lines.push("");
  lines.push(`# ${meta.title}`);
  lines.push("");
  lines.push(`> 类型：${meta.type} ｜ 导师：${meta.mentor || "未填写"}`);
  lines.push("");
  lines.push("## 简介");
  lines.push("");
  lines.push(meta.description || "（补充这个项目要做什么、为什么做。）");
  lines.push("");
  lines.push("## 教学目标");
  lines.push("");
  if (meta.goals.length) for (const goal of meta.goals) lines.push(`- ${goal}`);
  else lines.push("（补充这个项目的核心目标。）");
  lines.push("");
  lines.push("## 行动");
  lines.push("");
  lines.push("本项目的行动放在 `行动/` 子文件夹。");
  lines.push("");
  return lines.join("\n");
}

function renderGroupNote(meta: GroupMeta): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push("type: group");
  lines.push(`group_id: ${yamlValue(meta.group_id)}`);
  lines.push(`name: ${yamlValue(meta.name)}`);
  lines.push(`mentor: ${yamlValue(meta.mentor)}`);
  lines.push(`series: ${yamlValue(meta.series)}`);
  lines.push(`created_at: ${yamlValue(meta.created_at)}`);
  lines.push("members:");
  for (const member of meta.members) lines.push(`  - ${yamlValue(member)}`);
  if (!meta.members.length) lines.push("  []");
  lines.push("---");
  lines.push("");
  lines.push(`# ${meta.name}`);
  lines.push("");
  lines.push(`> 所属项目：${meta.series || "未指定"} ｜ 导师：${meta.mentor || "未填写"}`);
  lines.push("");
  lines.push("## 成员");
  lines.push("");
  if (meta.members.length) for (const member of meta.members) lines.push(`- ${member}`);
  else lines.push("（补充固定成员。）");
  lines.push("");
  lines.push("## 说明");
  lines.push("");
  lines.push(meta.description || "（这个小组固定参与哪些项目/行动。）");
  lines.push("");
  return lines.join("\n");
}

export async function createStudentProfile(app: App, settings: AssessmentSettings, name: string): Promise<string> {
  const clean = sanitizeName(name);
  const folder = `${studentRoot(settings)}/${clean}`;
  await ensureFolder(app, folder);
  const existing = await findStudentNote(app, folder);
  if (existing) return folder;
  const noteName = await uniqueEntityNoteName(app, clean, "学员");
  const notePath = `${folder}/${noteName}.md`;
  if (!(await pathExists(app, notePath))) {
    await writeText(
      app,
      notePath,
      [
        "---",
        "type: student",
        `name: ${yamlValue(clean)}`,
        'alias: ""',
        `created_at: ${yamlValue(nowISO())}`,
        "---",
        "",
        `# ${clean}`,
        "",
        "## 个性化目标",
        "",
        "（导师可在这里补充该学员本阶段的个性化素养目标。）",
        "",
        "## 参与活动",
        "",
        "（生成阶段报告时会自动汇总。）",
        "",
        "## 阶段报告",
        "",
      ].join("\n"),
    );
  }
  return folder;
}

export async function findActivityReportPath(app: App, record: ActivityRecord): Promise<string | null> {
  const candidates = [
    `${record.folder}/${SUBFOLDERS.reports}/${activityReportFileName(record.meta)}`,
    `${record.folder}/${SUBFOLDERS.reports}/活动成长报告.md`,
    `${record.folder}/${SUBFOLDERS.reports}/行动成长报告.md`,
  ];
  for (const path of candidates) {
    if (await pathExists(app, path)) return path;
  }
  return null;
}

export async function listStudentProfiles(app: App, settings: AssessmentSettings): Promise<StudentProfile[]> {
  const folders = await listFolders(app, studentRoot(settings));
  const profiles: StudentProfile[] = [];
  for (const folder of folders) {
    const notePath = await findStudentNote(app, folder);
    if (!notePath) continue;
    try {
      const markdown = await readText(app, notePath);
      const { frontmatter } = splitFrontmatter(markdown);
      let raw: Record<string, unknown> = {};
      if (frontmatter.trim()) {
        try {
          raw = asRecord(parseYaml(frontmatter));
        } catch {
          raw = {};
        }
      }
      const name = asString(raw.name) || folder.split("/").pop() || "";
      const alias = asString(raw.alias ?? raw.external_name ?? raw.public_name);
      if (name) profiles.push({ name, alias, notePath });
    } catch {
      /* 跳过读不出来的旧档案 */
    }
  }
  profiles.sort((a, b) => a.name.localeCompare(b.name, "zh"));
  return profiles;
}

function renderActivityNote(meta: ActivityMeta): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`action_id: ${yamlValue(meta.action_id)}`);
  lines.push(`title: ${yamlValue(meta.title)}`);
  lines.push(`type: ${yamlValue(meta.type)}`);
  lines.push(`date: ${yamlValue(meta.date)}`);
  lines.push(`start_time: ${yamlValue(meta.start_time)}`);
  lines.push(`end_time: ${yamlValue(meta.end_time)}`);
  lines.push(`mentor: ${yamlValue(meta.mentor)}`);
  lines.push(`series: ${yamlValue(meta.series)}`);
  lines.push(`series_id: ${yamlValue(meta.series_id)}`);
  lines.push(`sequence: ${meta.sequence ?? ""}`);
  lines.push("groups:");
  for (const group of meta.groups) lines.push(`  - ${yamlValue(group)}`);
  if (!meta.groups.length) lines.push("  []");
  lines.push("getnote_ids:");
  for (const id of meta.getnote_ids) lines.push(`  - ${yamlValue(id)}`);
  if (!meta.getnote_ids.length) lines.push("  []");
  lines.push("participants:");
  for (const name of meta.participants) lines.push(`  - ${yamlValue(name)}`);
  if (!meta.participants.length) lines.push("  []");
  lines.push("goals:");
  for (const goal of meta.goals) lines.push(`  - ${yamlValue(goal)}`);
  if (!meta.goals.length) lines.push("  []");
  lines.push(`framework: ${yamlValue(meta.framework)}`);
  lines.push(`status: ${yamlValue(meta.status)}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${meta.title}`);
  lines.push("");
  const timeLabel = [meta.date, meta.start_time, meta.end_time].filter(Boolean).join(" ");
  if (meta.series) {
    lines.push(`> 项目：${meta.series}${meta.sequence ? ` · 第 ${meta.sequence} 次` : ""}`);
    if (meta.groups.length) lines.push(`> 小组：${meta.groups.join("、")}`);
    lines.push(`> 时间：${timeLabel}`);
    lines.push("");
  } else if (timeLabel) {
    lines.push(`> 时间：${timeLabel}`);
    lines.push("");
  }
  lines.push("## 教学目标");
  lines.push("");
  if (meta.goals.length) {
    for (const goal of meta.goals) lines.push(`- ${goal}`);
  } else {
    lines.push("（导师补充：本次活动希望孩子发展什么？）");
  }
  lines.push("");
  lines.push("## 活动流程");
  lines.push("");
  lines.push("（导师补充：环节、时间、分组、任务。）");
  lines.push("");
  lines.push("## 观察记录");
  lines.push("");
  lines.push("（导师复盘、学习故事可以写在这里，也可以写成 md 放进 观察/ 目录。）");
  lines.push("");
  lines.push("## 素材");
  lines.push("");
  lines.push("把学习单、作品、录音、照片、视频放进 素材/，然后运行「扫描素材」和「AI 整理」。");
  lines.push("");
  lines.push("## 报告");
  lines.push("");
  lines.push("生成后见 报告/活动成长报告.md。");
  lines.push("");
  return lines.join("\n");
}

export async function createActivity(
  app: App,
  settings: AssessmentSettings,
  input: NewActivityInput,
): Promise<ActivityRecord> {
  const requestedSeries = input.series.trim();
  const unassigned = !requestedSeries || requestedSeries === "暂不归属";
  const seriesRecord = unassigned ? null : await ensureSeriesFolder(app, settings, requestedSeries);
  const actionRoot = unassigned
    ? `${seriesRoot(settings)}/暂不归属/行动`
    : seriesActionsFolder(seriesRecord!.folder);
  await ensureFolder(app, actionRoot);
  const date = input.date || todayISO();
  const base = activityFolderName(date, input.title);
  const folder = await uniqueFolder(app, actionRoot, base);
  for (const sub of Object.values(SUBFOLDERS)) {
    await ensureFolder(app, `${folder}/${sub}`);
  }

  const groups = input.groups ?? [];
  const groupMembers: string[] = [];
  for (const groupName of groups) {
    const group = (await listGroups(app, settings)).find((item) => item.meta.name === groupName);
    if (group) groupMembers.push(...group.meta.members);
  }
  const participants = unique([...parseParticipants(input.participantsText), ...groupMembers]);
  const goals = parseGoals(input.goalsText);
  const type: ActivityType = normalizeActivityType(input.type);
  const sequenceRaw = Number(input.sequence);
  const meta: ActivityMeta = {
    action_id: `act_${date.replace(/\D/g, "")}_${Math.random().toString(36).slice(2, 8)}`,
    title: input.title.trim() || "未命名行动",
    type,
    date,
    start_time: input.startTime.trim(),
    end_time: input.endTime.trim(),
    mentor: input.mentor.trim(),
    participants,
    goals,
    framework: resolveFrameworkPath(settings),
    status: "收集中",
    series: seriesRecord?.meta.title ?? "",
    series_id: seriesRecord?.meta.series_id ?? "",
    sequence: Number.isFinite(sequenceRaw) && sequenceRaw > 0 ? Math.round(sequenceRaw) : null,
    groups,
    getnote_ids: [],
  };

  const noteName = await uniqueEntityNoteName(app, meta.title, seriesRecord?.meta.title ?? "暂不归属");
  const notePath = `${folder}/${noteName}.md`;
  await writeText(app, notePath, renderActivityNote(meta));
  for (const name of participants) {
    await createStudentProfile(app, settings, name);
  }
  const body = renderActivityNote(meta);
  return { folder, notePath, meta, body };
}

export async function updateActivityStatus(app: App, folder: string, status: string): Promise<void> {
  const notePath = await findEntityNote(app, folder, "action");
  if (!notePath) return;
  const file = app.vault.getAbstractFileByPath(normalizePath(notePath));
  if (file instanceof TFile) {
    await app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter.status = status;
      frontmatter.updated = nowISO();
    });
  }
}

export async function listArtifacts(app: App, activityFolder: string): Promise<ArtifactInfo[]> {
  const materials = `${activityFolder}/${SUBFOLDERS.materials}`;
  const files = await walkFiles(app, materials);
  const transcriptFolder = `${activityFolder}/${SUBFOLDERS.transcripts}`;
  const descriptionPath = `${transcriptFolder}/${"图像说明.md"}`;
  const descriptions = (await pathExists(app, descriptionPath)) ? await readText(app, descriptionPath) : "";
  const out: ArtifactInfo[] = [];
  for (const file of files) {
    const name = file.split("/").pop() ?? file;
    const stat = await app.vault.adapter.stat(file);
    const hasTranscript = await pathExists(app, `${transcriptFolder}/${stemOf(name)}.md`);
    out.push({
      path: file,
      name,
      stem: stemOf(name),
      kind: classifyFile(name),
      size: stat?.size ?? 0,
      mtime: stat?.mtime ?? 0,
      hasTranscript,
      hasDescription: descriptions.includes(`## ${name}`),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, "zh"));
  return out;
}

export interface TextBlock {
  label: string;
  text: string;
}

export async function collectTextBlocks(app: App, activityFolder: string): Promise<TextBlock[]> {
  const out: TextBlock[] = [];
  for (const sub of [SUBFOLDERS.observations, SUBFOLDERS.transcripts, SUBFOLDERS.materials]) {
    const root = `${activityFolder}/${sub}`;
    for (const file of await walkFiles(app, root)) {
      if (!/\.(md|markdown|txt|csv)$/i.test(file)) continue;
      try {
        const text = await readText(app, file);
        if (text.trim()) out.push({ label: file.replace(`${activityFolder}/`, ""), text });
      } catch {
        /* 跳过读不出来的文件 */
      }
    }
  }
  return out;
}

export async function normalizeEntityFilenames(app: App, settings: AssessmentSettings): Promise<number> {
  let changed = 0;
  const renameNote = async (
    notePath: string,
    folder: string,
    desired: string,
    suffix: string,
  ): Promise<void> => {
    const current = notePath.split("/").pop()?.replace(/\.md$/i, "") ?? "";
    const base = sanitizeName(desired);
    if (current === base) return;
    const nextName = await uniqueEntityNoteName(app, desired, suffix, notePath);
    if (nextName === current) return;
    const file = app.vault.getAbstractFileByPath(normalizePath(notePath));
    if (!(file instanceof TFile)) return;
    await app.fileManager.renameFile(file, normalizePath(`${folder}/${nextName}.md`));
    changed++;
  };

  for (const activity of await listActivities(app, settings)) {
    await renameNote(activity.notePath, activity.folder, activity.meta.title, "行动");
  }
  for (const series of await listSeriesRecords(app, settings)) {
    await renameNote(series.notePath, series.folder, series.meta.title, "系列");
  }
  for (const group of await listGroups(app, settings)) {
    await renameNote(group.notePath, group.folder, group.meta.name, "小组");
  }

  const names = unique([
    ...(await listActivities(app, settings)).flatMap((activity) => activity.meta.participants),
    ...(await listGroups(app, settings)).flatMap((group) => group.meta.members),
  ]);
  for (const name of names) {
    const folder = `${studentRoot(settings)}/${sanitizeName(name)}`;
    const notePath = await findStudentNote(app, folder);
    if (notePath) await renameNote(notePath, folder, name, "学员");
  }
  return changed;
}

interface EntityLink {
  name: string;
  path: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function autoLinkBody(
  body: string,
  index: EntityLink[],
  skipNames: Set<string>,
  used = new Set<string>(),
): string {
  const usable = index.filter((item) => item.name.length >= 2 && !skipNames.has(item.name));
  if (!usable.length) return body;
  const byName = new Map(usable.map((item) => [item.name, item]));
  const names = [...new Set(usable.map((item) => item.name))].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(names.map(escapeRegExp).join("|"), "g");
  const protectedPattern =
    /(```[\s\S]*?```|`[^`\n]*`|\[\[[^\]]*\]\]|\[[^\]]*\]\([^)]*\)|https?:\/\/\S+|<!--[\s\S]*?-->|<[^>]+>)/g;

  const linkSegment = (segment: string): string =>
    segment.replace(pattern, (matched) => {
      if (used.has(matched)) return matched;
      const entity = byName.get(matched);
      if (!entity) return matched;
      used.add(matched);
      return wikiLink(entity.path, matched);
    });

  let output = "";
  let cursor = 0;
  for (const match of body.matchAll(protectedPattern)) {
    const start = match.index ?? 0;
    output += linkSegment(body.slice(cursor, start));
    output += match[0];
    cursor = start + match[0].length;
  }
  output += linkSegment(body.slice(cursor));
  return output;
}

async function syncInlineLinks(
  app: App,
  path: string,
  index: EntityLink[],
  skipNames: Set<string>,
): Promise<void> {
  if (!(await pathExists(app, path))) return;
  const markdown = await readText(app, path);
  const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
  const prefix = frontmatterMatch ? frontmatterMatch[0] : "";
  const body = markdown.slice(prefix.length);
  const blockPattern = /<!-- literacy-links:start -->[\s\S]*?<!-- literacy-links:end -->/;
  const blockMatch = blockPattern.exec(body);
  const block = blockMatch?.[0] ?? "";
  const bodyWithoutBlock = blockMatch ? body.replace(blockMatch[0], "") : body;

  const byPath = new Map(index.map((item) => [item.path.replace(/\.md$/i, ""), item.name]));
  const names = new Set(index.map((item) => item.name));
  const used = new Set<string>();
  const linkPattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  for (const link of bodyWithoutBlock.matchAll(linkPattern)) {
    const target = link[1].replace(/\.md$/i, "");
    const label = link[2] ?? target.split("/").pop() ?? "";
    const name = byPath.get(target) ?? label;
    if (name && names.has(name)) used.add(name);
  }

  const nextBody = autoLinkBody(bodyWithoutBlock, index, skipNames, used);
  const next = block ? `${nextBody.trimEnd()}\n\n${block}\n` : nextBody;
  if (next !== body) await writeText(app, path, `${prefix}${next}`);
}

export async function syncAllRelations(app: App, settings: AssessmentSettings): Promise<void> {
  const activities = await listActivities(app, settings);
  const seriesList = await listSeriesRecords(app, settings);
  const groupList = await listGroups(app, settings);
  const studentNames = unique([
    ...activities.flatMap((activity) => activity.meta.participants),
    ...groupList.flatMap((group) => group.meta.members),
  ]);
  const studentNotes = new Map<string, string>();
  for (const name of studentNames) {
    await createStudentProfile(app, settings, name);
    const folder = `${studentRoot(settings)}/${sanitizeName(name)}`;
    const note = await findStudentNote(app, folder);
    if (note) studentNotes.set(name, note);
  }

  const entityMap = new Map<string, string>();
  const addEntity = (name: string, path: string) => {
    if (name.length >= 2 && !entityMap.has(name)) entityMap.set(name, path);
  };
  for (const series of seriesList) addEntity(series.meta.title, series.notePath);
  for (const group of groupList) addEntity(group.meta.name, group.notePath);
  for (const [name, path] of studentNotes) addEntity(name, path);
  for (const activity of activities) addEntity(activity.meta.title, activity.notePath);
  addEntity("素养框架", resolveFrameworkPath(settings));
  const entityIndex: EntityLink[] = [...entityMap].map(([name, path]) => ({ name, path }));

  const studentLink = (name: string) => {
    const note = studentNotes.get(name);
    return note ? wikiLink(note, name) : name;
  };
  const groupLink = (name: string) => {
    const group = groupList.find((item) => item.meta.name === name);
    return group ? wikiLink(group.notePath, name) : name;
  };
  const seriesLink = (name: string) => {
    const series = seriesList.find((item) => item.meta.title === name);
    return series ? wikiLink(series.notePath, name) : name;
  };
  const actionLink = (activity: ActivityRecord) => wikiLink(activity.notePath, activity.meta.title);
  const frameworkLink = wikiLink(resolveFrameworkPath(settings), "素养框架");

  const relationBlock = (activity: ActivityRecord): string => {
    const lines = ["## 关联", ""];
    lines.push(`- 项目：${activity.meta.series ? seriesLink(activity.meta.series) : "暂不归属"}`);
    if (activity.meta.groups.length) {
      lines.push(`- 小组：${activity.meta.groups.map(groupLink).join("、")}`);
    }
    if (activity.meta.participants.length) {
      lines.push(`- 学员：${activity.meta.participants.map(studentLink).join("、")}`);
    }
    lines.push(`- 框架：${frameworkLink}`);
    return lines.join("\n");
  };

  for (const activity of activities) {
    await upsertLinkBlock(app, activity.notePath, relationBlock(activity));
    await syncInlineLinks(app, activity.notePath, entityIndex, new Set([activity.meta.title]));
    const reportPath = await findActivityReportPath(app, activity);
    if (reportPath) {
      await upsertLinkBlock(app, reportPath, relationBlock(activity));
      await syncInlineLinks(app, reportPath, entityIndex, new Set());
    }
    const evidencePath = `${activity.folder}/${SUBFOLDERS.evidence}/证据.md`;
    if (await pathExists(app, evidencePath)) {
      await syncInlineLinks(app, evidencePath, entityIndex, new Set());
    }
    for (const observation of await walkFiles(app, `${activity.folder}/${SUBFOLDERS.observations}`)) {
      if (/\.md$/i.test(observation)) await syncInlineLinks(app, observation, entityIndex, new Set());
    }
  }

  for (const series of seriesList) {
    const relatedActions = activities.filter((activity) => activity.meta.series === series.meta.title);
    const relatedGroups = groupList.filter(
      (group) =>
        group.meta.series === series.meta.title ||
        relatedActions.some((activity) => activity.meta.groups.includes(group.meta.name)),
    );
    const relatedStudents = unique(relatedActions.flatMap((activity) => activity.meta.participants));
    const lines = ["## 关联", ""];
    if (relatedGroups.length) lines.push(`- 小组：${relatedGroups.map((group) => groupLink(group.meta.name)).join("、")}`);
    if (relatedActions.length) lines.push(`- 行动：${relatedActions.map(actionLink).join("、")}`);
    if (relatedStudents.length) lines.push(`- 学员：${relatedStudents.map(studentLink).join("、")}`);
    lines.push(`- 框架：${frameworkLink}`);
    await upsertLinkBlock(app, series.notePath, lines.join("\n"));
    await syncInlineLinks(app, series.notePath, entityIndex, new Set([series.meta.title]));
  }

  for (const group of groupList) {
    const relatedActions = activities.filter((activity) => activity.meta.groups.includes(group.meta.name));
    const lines = ["## 关联", ""];
    if (group.meta.series) lines.push(`- 项目：${seriesLink(group.meta.series)}`);
    if (group.meta.members.length) lines.push(`- 成员：${group.meta.members.map(studentLink).join("、")}`);
    if (relatedActions.length) lines.push(`- 行动：${relatedActions.map(actionLink).join("、")}`);
    await upsertLinkBlock(app, group.notePath, lines.join("\n"));
    await syncInlineLinks(app, group.notePath, entityIndex, new Set([group.meta.name]));
  }

  for (const name of studentNames) {
    const relatedActions = activities.filter((activity) => activity.meta.participants.includes(name));
    const relatedGroups = groupList.filter((group) => group.meta.members.includes(name));
    const relatedSeries = unique(relatedActions.map((activity) => activity.meta.series).filter(Boolean));
    const folder = `${studentRoot(settings)}/${sanitizeName(name)}`;
    const lines = ["## 关联", ""];
    if (relatedGroups.length) lines.push(`- 小组：${relatedGroups.map((group) => groupLink(group.meta.name)).join("、")}`);
    if (relatedSeries.length) lines.push(`- 项目：${relatedSeries.map(seriesLink).join("、")}`);
    if (relatedActions.length) lines.push(`- 行动：${relatedActions.map(actionLink).join("、")}`);
    const reportLinks: string[] = [];
    for (const file of await walkFiles(app, folder)) {
      if (!/\.md$/i.test(file)) continue;
      if (!/项目成长报告|系列成长报告|阶段成长报告/.test(file)) continue;
      if (/_对外\.md$/i.test(file)) continue;
      reportLinks.push(wikiLink(file, file.split("/").pop()?.replace(/\.md$/i, "") ?? "报告"));
      await upsertLinkBlock(app, file, ["## 关联", "", `- 学员：${studentLink(name)}`].join("\n"));
      await syncInlineLinks(app, file, entityIndex, new Set());
    }
    if (reportLinks.length) lines.push(`- 报告：${reportLinks.join("、")}`);
    const profilePath = studentNotes.get(name);
    if (profilePath) {
      await upsertLinkBlock(app, profilePath, lines.join("\n"));
      await syncInlineLinks(app, profilePath, entityIndex, new Set([name]));
    }
  }
}

export const DEFAULT_FRAMEWORK = `# 白日梦行动 · 素养框架（简版）

> 这是插件首次运行时生成的占位框架。请把《职业探索素养路标》的完整 U-K-S 目标粘贴到本文件，或保留简版先跑通流程。
> 评估报告会读取本文件作为「素养发展目标」的参照。

## 使用约定

1. 每条目标最好带编号（如 \`CCD.3-L3\`），方便报告引用。
2. 水平 L1-L7：幼儿 0-5 / 儿童 5-8 / 青少年 8-12 / 青少年 12-16 / 青少年 16-23 / 青年 24-32 / 成人。
3. 没有证据时写「未观察到」，不要写「不具备」。

## 一级维度与二级维度

### 1. CCD 职业认知与发展

- **CCD.1 职业使命**：职业不仅包含具体工作，也包含对自我和他人价值的实现。
- **CCD.2 使命带来成就感**：使命和价值，与职业中的体验、感受和成就感密切相关。
- **CCD.3 与他人协作**：协作能形成更大群体、解决更大问题，也带来冲突与责任。
- **CCD.4 工具和能力**：工具拓展我们的能力，帮助我们实现使命和价值。
- **CCD.5 职业创造**：社会与职业影响收入、发展和内心丰盈，我们也能通过创造推动它变化。

### 2. SDU 自我发现与自我认知

- **SDU.1 感知与多角色**：感知自己的感受、经历和观点，理解自己承担的不同社会角色。
- **SDU.2 综合与自我灵活性**：综合多方信息，批判性地调整自我认知，在不同情境中保持灵活。
- **SDU.3 接纳与积极弹性**：接纳自我，保持积极和灵活的自我概念。
- **SDU.4 社会互动与自我**：社会互动和自我实现，丰富我们对自我的认知。

### 3. LLM 终身学习与元认知

- **LLM.1 了解趋势**：了解社会与领域的历史、规律和趋势，设定合理的发展目标。
- **LLM.2 设定发展目标**：基于自我认知和趋势，确定多个层次的目标。
- **LLM.3 营造学习环境**：调整与他人的关系和自身定位，营造良好的学习发展环境。
- **LLM.4 付诸行动**：在行动、反思和迭代中发展多个层次的能力。
- **LLM.5 发展自我**：在真实世界的创造中学习，既发展能力，也丰富内在自我。

## 评估重点

- 看具体行为、情境和变化，不贴标签。
- 一次活动只评估本次活动目标覆盖的维度；阶段报告再看跨活动趋势。
- 每条结论都要能回到素材原文或画面。
`;

export const ACTIVITY_REPORT_TEMPLATE = `# 活动成长报告模板

> 生成报告后，导师可以按这个结构手动补充或修改。

## 一、活动概览

## 二、教学目标与证据覆盖

## 三、学员观察

## 四、导师建议

## 五、待补证据
`;
