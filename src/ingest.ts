/**
 * 得到大脑录音导入：先把每条笔记暂存到 05_导入/得到/，再尝试匹配已有行动。
 * 只有可靠匹配时才把转写/总结拷贝到该行动的 素材/；原始录音始终留在 得到/。
 */
import type { App } from "obsidian";
import { normalizePath } from "obsidian";
import type { ActivityRecord, AssessmentSettings } from "./types";
import { SUBFOLDERS } from "./types";
import {
  commonSubstringLength,
  decideActionMatch,
  importsRoot,
  matchNoteToActions,
  sanitizeName,
  todayISO,
} from "./core";
import {
  addExternalId,
  ensureFolder,
  listActivities,
  listSeriesRecords,
  pathExists,
  readText,
  wikiLink,
  writeBinary,
  writeText,
} from "./vault";
import {
  GETNOTE_AUDIO_TYPES,
  downloadGetnoteBinary,
  getGetnoteNote,
  listGetnoteNotes,
  type GetnoteNoteDetail,
} from "./getnote";
import type { ProgressSink } from "./organize";

export interface GetnoteImportSummary {
  fetched: number;
  /** 本次新暂存到 05_导入/得到/ 的条数 */
  staged: number;
  /** 转写/总结成功拷贝到已有行动 素材/ 的条数 */
  matched: number;
  /** 仍未匹配、继续留在 得到/ 的条数 */
  pending: number;
  skipped: number;
  failed: number;
  notes: string[];
  errors: string[];
}

type LedgerStatus = "pending" | "imported";

interface LedgerEntry {
  id: string;
  title: string;
  staging_folder: string;
  action_folder: string;
  status: LedgerStatus;
  recorded_at: string;
  imported_at: string;
}

function ledgerPath(settings: AssessmentSettings): string {
  return `${importsRoot(settings)}/得到/已导入.json`;
}

function stageRoot(settings: AssessmentSettings): string {
  return `${importsRoot(settings)}/得到`;
}

async function readLedger(app: App, settings: AssessmentSettings): Promise<LedgerEntry[]> {
  const path = ledgerPath(settings);
  if (!(await pathExists(app, path))) return [];
  try {
    const raw = JSON.parse(await readText(app, path)) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((entry) => {
        const record = entry as Record<string, unknown>;
        const status: LedgerStatus = record.status === "pending" ? "pending" : "imported";
        return {
          id: typeof record.id === "string" ? record.id : "",
          title: typeof record.title === "string" ? record.title : "",
          staging_folder: typeof record.staging_folder === "string" ? record.staging_folder : "",
          action_folder: typeof record.action_folder === "string" ? record.action_folder : "",
          status,
          recorded_at: typeof record.recorded_at === "string" ? record.recorded_at : "",
          imported_at: typeof record.imported_at === "string" ? record.imported_at : "",
        };
      })
      .filter((entry) => entry.id);
  } catch {
    return [];
  }
}

async function saveLedger(app: App, settings: AssessmentSettings, ledger: LedgerEntry[]): Promise<void> {
  const path = ledgerPath(settings);
  await ensureFolder(app, path.split("/").slice(0, -1).join("/"));
  await writeText(app, path, `${JSON.stringify(ledger, null, 2)}\n`);
}

function localDateParts(iso: string): { date: string; time: string } {
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) return { date: todayISO(), time: "" };
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`,
    time: `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`,
  };
}

function audioUrlOf(detail: GetnoteNoteDetail): string {
  if (detail.audio?.play_url) return detail.audio.play_url;
  const attachment = detail.attachments?.find((item) => /audio|mp3|m4a|wav|aac/i.test(`${item.type} ${item.url}`));
  return attachment?.url ?? "";
}

function extensionOf(url: string, fallback = "mp3"): string {
  try {
    const pathname = new URL(url).pathname;
    const match = /\.([A-Za-z0-9]{2,5})$/.exec(pathname);
    return match ? match[1].toLowerCase() : fallback;
  } catch {
    const match = /\.([A-Za-z0-9]{2,5})(?:\?|$)/.exec(url);
    return match ? match[1].toLowerCase() : fallback;
  }
}

async function uniquePath(app: App, folder: string, base: string, extension: string): Promise<string> {
  let candidate = `${folder}/${base}.${extension}`;
  let index = 2;
  while (await pathExists(app, candidate)) {
    candidate = `${folder}/${base}_${index}.${extension}`;
    index++;
  }
  return candidate;
}

async function uniqueFolderPath(app: App, root: string, base: string): Promise<string> {
  let candidate = `${root}/${base}`;
  let index = 2;
  while (await pathExists(app, candidate)) {
    candidate = `${root}/${base}_${index}`;
    index++;
  }
  return candidate;
}

function renderTranscript(detail: GetnoteNoteDetail, transcript: string): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push("type: transcript");
  lines.push('source: "得到大脑"');
  lines.push(`getnote_id: "${detail.id}"`);
  lines.push(`title: "${(detail.title || "").replace(/"/g, '\\"')}"`);
  lines.push(`created_at: "${detail.created_at}"`);
  if (detail.audio?.duration) lines.push(`duration: ${detail.audio.duration}`);
  lines.push("---");
  lines.push("");
  lines.push(`# 得到转写：${detail.title || detail.id}`);
  lines.push("");
  lines.push("> 由得到大脑 OpenAPI 同步；转写可能有错字，引用前请对照原音。");
  lines.push("");
  lines.push(transcript);
  lines.push("");
  return lines.join("\n");
}

function renderSummary(detail: GetnoteNoteDetail): string {
  return [
    "---",
    "type: observation",
    'source: "得到大脑"',
    `getnote_id: "${detail.id}"`,
    `created_at: "${detail.created_at}"`,
    "---",
    "",
    `# 得到总结：${detail.title || detail.id}`,
    "",
    "> 来自得到大脑的 AI 总结，不是逐字稿；证据引用请优先用转写原文。",
    "",
    detail.content || "（没有总结内容）",
    "",
  ].join("\n");
}

function renderNoteInfo(detail: GetnoteNoteDetail, stageFolder: string, status: LedgerStatus): string {
  const local = localDateParts(detail.created_at || new Date().toISOString());
  return [
    "---",
    "type: getnote_import",
    'source: "得到大脑"',
    `getnote_id: "${detail.id}"`,
    `status: "${status}"`,
    `created_at: "${detail.created_at}"`,
    "---",
    "",
    `# 得到笔记：${detail.title || detail.id}`,
    "",
    `> 暂存位置：${stageFolder}`,
    `> 录音时间：${local.date} ${local.time}`,
    `> 时长：${detail.audio?.duration ? `${detail.audio.duration} 秒` : "未提供"}`,
    "",
    "## 处理说明",
    "",
    "这是得到笔记的暂存说明。暂存时先放在 `05_导入/得到/`；",
    "匹配成功后，插件只把转写、总结拷贝到该行动的 `素材/`；原始录音和相关文件始终留在本暂存文件夹。",
    "也可以手动把转写/总结拖进目标行动的 `素材/`，但下次同步前请确认不会重复。",
    "",
  ].join("\n");
}

async function findExistingStageFolder(
  app: App,
  settings: AssessmentSettings,
  noteId: string,
): Promise<string | null> {
  const root = stageRoot(settings);
  if (!(await pathExists(app, root))) return null;
  const listing = await app.vault.adapter.list(normalizePath(root));
  for (const folder of listing.folders) {
    const files = await app.vault.adapter.list(folder);
    const info = files.files.find((file) => /\/笔记信息_.*\.md$/i.test(file));
    if (!info) continue;
    const text = await readText(app, info);
    if (text.includes(`getnote_id: "${noteId}"`) || text.includes(`getnote_id: ${noteId}`)) return folder;
  }
  return null;
}

async function stageNote(
  app: App,
  settings: AssessmentSettings,
  detail: GetnoteNoteDetail,
  progress: ProgressSink,
): Promise<string> {
  const base = sanitizeName(detail.title || `得到录音_${detail.id}`);
  const local = localDateParts(detail.created_at || new Date().toISOString());
  const folder = await uniqueFolderPath(app, stageRoot(settings), sanitizeName(`${local.date}_${base}`));
  await ensureFolder(app, folder);

  const transcript = detail.audio?.original?.trim() ?? "";
  if (transcript) {
    const path = `${folder}/得到转写_${base}.md`;
    await writeText(app, path, renderTranscript(detail, transcript));
    progress.log(`暂存转写：${path}`);
  }

  if (detail.content?.trim()) {
    const path = `${folder}/得到总结_${base}.md`;
    await writeText(app, path, renderSummary(detail));
    progress.log(`暂存总结：${path}`);
  }

  const audioUrl = audioUrlOf(detail);
  if (settings.getnoteDownloadAudio && audioUrl) {
    progress.status(`下载录音到暂存区：${detail.title || detail.id}…`);
    try {
      const binary = await downloadGetnoteBinary(audioUrl);
      const extension = extensionOf(audioUrl);
      const path = `${folder}/得到录音_${base}.${extension}`;
      await writeBinary(app, path, binary);
      progress.log(`暂存录音：${path}`);
    } catch (error) {
      progress.log(`录音下载失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const infoPath = `${folder}/笔记信息_${base}.md`;
  await writeText(app, infoPath, renderNoteInfo(detail, folder, "pending"));
  return folder;
}

async function copyStageToAction(
  app: App,
  stageFolder: string,
  target: ActivityRecord,
  detail: GetnoteNoteDetail,
): Promise<void> {
  const destFolder = `${target.folder}/${SUBFOLDERS.materials}`;
  await ensureFolder(app, destFolder);
  const listing = await app.vault.adapter.list(normalizePath(stageFolder));
  for (const file of listing.files) {
    const name = file.split("/").pop() ?? file;
    // 原始录音留在 05_导入/得到/；只拷贝转写和总结到行动 素材/。
    if (!/^得到(转写|总结)_.*\.md$/i.test(name)) continue;
    const match = /^(.*?)(\.[A-Za-z0-9]{1,6})$/.exec(name);
    const base = match ? match[1] : name;
    const extension = match ? match[2].replace(".", "") : "md";
    const destination = await uniquePath(app, destFolder, base, extension);
    const content = await app.vault.adapter.read(normalizePath(file));
    await writeText(app, destination, content);
  }
}

function matchTarget(
  detail: GetnoteNoteDetail,
  activities: ActivityRecord[],
  settings: AssessmentSettings,
): { target?: ActivityRecord; reason: string } {
  const transcript = detail.audio?.original?.trim() || detail.content?.trim() || "";
  const createdAt = detail.created_at || new Date().toISOString();
  const durationSec = detail.audio?.duration ?? detail.attachments?.find((item) => item.duration)?.duration;
  const matches = matchNoteToActions(
    { title: detail.title || "", transcript, createdAt, durationSec },
    activities.map((record) => record.meta),
    { windowHours: settings.getnoteMatchHours },
  );
  const decision = decideActionMatch(matches);
  if (decision.confident && decision.best) {
    return {
      target: activities.find((record) => record.meta.action_id === decision.best?.action.action_id),
      reason: decision.best.reasons.join("；"),
    };
  }
  if (matches.length === 1 && matches[0].score >= 4) {
    return {
      target: activities.find((record) => record.meta.action_id === matches[0].action.action_id),
      reason: "唯一候选",
    };
  }

  // 强系列名信号：例如「概念图项目商讨」与系列「青少年概念图项目」
  // 共同片段足够长，且该系列下只有一个候选行动时，按系列归口。
  const noteText = `${detail.title || ""}\n${transcript}`;
  const seriesCandidates = activities.filter((activity) => {
    const name = activity.meta.series.trim();
    if (!name || name === "暂不归属") return false;
    return commonSubstringLength(name, noteText) >= 4;
  });
  if (seriesCandidates.length === 1) {
    return { target: seriesCandidates[0], reason: "系列名共同片段可靠命中" };
  }

  return { reason: matches.length ? "候选不够可靠" : "没有匹配到已有行动" };
}

function catalogCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

async function stagingInfoPath(app: App, folder: string): Promise<string | null> {
  if (!(await pathExists(app, folder))) return null;
  const listing = await app.vault.adapter.list(normalizePath(folder));
  const info = listing.files.find((file) => /\/笔记信息_.*\.md$/i.test(file));
  return info ?? null;
}

async function writeCatalog(
  app: App,
  settings: AssessmentSettings,
  ledger: LedgerEntry[],
  activities: ActivityRecord[],
  errors: string[],
): Promise<string> {
  const path = `${importsRoot(settings)}/得到/00_得到导入总目录.md`;
  const seriesList = await listSeriesRecords(app, settings);
  const actionMap = new Map(activities.map((activity) => [activity.folder, activity]));
  const seriesMap = new Map(seriesList.map((series) => [series.meta.title, series]));
  const sorted = [...ledger].sort((a, b) => {
    const aTime = a.imported_at || a.staging_folder.match(/\d{4}-\d{2}-\d{2}/)?.[0] || "";
    const bTime = b.imported_at || b.staging_folder.match(/\d{4}-\d{2}-\d{2}/)?.[0] || "";
    return bTime.localeCompare(aTime) || a.title.localeCompare(b.title, "zh");
  });

  const pending = ledger.filter((entry) => entry.status === "pending").length;
  const imported = ledger.filter((entry) => entry.status === "imported").length;
  const lines = [
    "# 得到导入总目录",
    "",
    `> 最后更新：${new Date().toISOString()}`,
    `> 已归口 ${imported} 条 ｜ 待匹配 ${pending} 条 ｜ 台账共 ${ledger.length} 条`,
    "",
    "原始录音/笔记信息始终留在 `05_导入/得到/`；匹配成功后只把「得到转写 / 得到总结」拷贝到对应行动的 `素材/`。",
    "",
    "| 导入时间 | 得到笔记 | 录音时间 | 状态 | 存放位置 | 归属项目 | 归属行动 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const entry of sorted) {
    const action = entry.action_folder ? actionMap.get(entry.action_folder) : undefined;
    const series = action?.meta.series ? seriesMap.get(action.meta.series) : undefined;
    const date = (entry.imported_at || entry.staging_folder.match(/\d{4}-\d{2}-\d{2}/)?.[0] || "").slice(0, 10);
    const recordedAt = entry.recorded_at || entry.staging_folder.match(/\d{4}-\d{2}-\d{2}/)?.[0] || "—";
    const title = entry.title || entry.id;
    const noteCell = `**${catalogCell(title)}**<br><code>${catalogCell(entry.id)}</code>`;
    const status = entry.status === "imported" ? "✅ 已归口" : "⏳ 待匹配";
    let location: string;
    if (entry.status === "imported" && action) {
      location = `${wikiLink(action.notePath, "素材位置")}<br><code>${catalogCell(`${action.folder}/素材/`)}</code><br>原始：<code>${catalogCell(entry.staging_folder || "（未记录）")}</code>`;
    } else if (entry.status === "imported") {
      location = `素材：\`${catalogCell(entry.action_folder || "（已归口，行动笔记不存在）")}\`<br>原始：<code>${catalogCell(entry.staging_folder || "（未记录）")}</code>`;
    } else {
      const infoPath = entry.staging_folder ? await stagingInfoPath(app, entry.staging_folder) : null;
      const link = infoPath ? wikiLink(infoPath, "打开暂存") : "暂存文件夹";
      location = `${link}<br><code>${catalogCell(entry.staging_folder || "（未记录暂存位置）")}</code>`;
    }
    const seriesCell = series ? wikiLink(series.notePath, series.meta.title) : "—";
    const actionCell = action ? wikiLink(action.notePath, action.meta.title) : "—";
    lines.push(
      `| ${catalogCell(date)} | ${noteCell} | ${catalogCell(recordedAt)} | ${status} | ${location} | ${seriesCell} | ${actionCell} |`,
    );
  }

  if (!sorted.length) {
    lines.push("| — | 还没有导入记录 | — | — | — | — | — |");
  }

  if (errors.length) {
    lines.push("", "## 上次同步失败", "");
    for (const error of errors) lines.push(`- ${catalogCell(error)}`);
  }

  lines.push("");
  await writeText(app, path, lines.join("\n"));
  return path;
}

export async function importGetnoteRecordings(
  app: App,
  settings: AssessmentSettings,
  progress: ProgressSink,
): Promise<GetnoteImportSummary> {
  const summary: GetnoteImportSummary = {
    fetched: 0,
    staged: 0,
    matched: 0,
    pending: 0,
    skipped: 0,
    failed: 0,
    notes: [],
    errors: [],
  };
  const now = new Date();
  const from = new Date(now.getTime() - Math.max(1, settings.getnoteSyncDays) * 86_400_000);
  progress.status("连接得到大脑，读取录音列表…");
  const notes = await listGetnoteNotes(settings, {
    createdFrom: from.toISOString(),
    createdTo: now.toISOString(),
    pageSize: 50,
    source: settings.getnoteSource,
  });
  const candidates = notes.filter((note) => GETNOTE_AUDIO_TYPES.has(note.note_type));
  summary.fetched = candidates.length;
  progress.log(`最近 ${settings.getnoteSyncDays} 天：${notes.length} 条笔记，其中录音类 ${candidates.length} 条。`);

  const ledger = await readLedger(app, settings);
  const activities = await listActivities(app, settings);

  for (const note of candidates) {
    if (progress.cancelled()) {
      summary.notes.push("用户中止了同步。");
      break;
    }

    let entry = ledger.find((item) => item.id === note.id);
    if (entry?.status === "imported") {
      summary.skipped++;
      continue;
    }

    let detail: GetnoteNoteDetail;
    try {
      progress.status(`读取得到笔记：${note.title || note.id}…`);
      detail = await getGetnoteNote(settings, note.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.failed++;
      summary.errors.push(`${note.title || note.id}：${message}`);
      summary.notes.push(`${note.title || note.id}：${message}`);
      progress.log(`读取失败：${note.title || note.id}（${message}）`);
      continue;
    }

    const title = detail.title || note.title || detail.id;
    if (!entry) {
      const existing = await findExistingStageFolder(app, settings, detail.id);
      if (existing) {
        entry = {
          id: detail.id,
          title,
          staging_folder: existing,
          action_folder: "",
          status: "pending",
          recorded_at: detail.created_at || "",
          imported_at: "",
        };
        ledger.push(entry);
        await saveLedger(app, settings, ledger);
        progress.log(`发现已有暂存，不重复导入：${existing}`);
      } else {
        progress.status(`暂存得到笔记：${title}…`);
        const folder = await stageNote(app, settings, detail, progress);
        entry = {
          id: detail.id,
          title,
          staging_folder: folder,
          action_folder: "",
          status: "pending",
          recorded_at: detail.created_at || "",
          imported_at: "",
        };
        ledger.push(entry);
        await saveLedger(app, settings, ledger);
        summary.staged++;
        progress.log(`已暂存到：${folder}`);
      }
    } else if (!entry.staging_folder || !(await pathExists(app, entry.staging_folder))) {
      const existing = await findExistingStageFolder(app, settings, detail.id);
      if (existing) {
        entry.staging_folder = existing;
        await saveLedger(app, settings, ledger);
        progress.log(`台账路径已修正到已有暂存：${existing}`);
      } else {
        progress.status(`重新暂存得到笔记：${title}…`);
        entry.staging_folder = await stageNote(app, settings, detail, progress);
        await saveLedger(app, settings, ledger);
        summary.staged++;
      }
    }

    const match = matchTarget(detail, activities, settings);
    if (!match.target) {
      summary.pending++;
      summary.notes.push(`${title}：${match.reason}，留在 05_导入/得到/，没有新建行动。`);
      progress.log(`未匹配：${title}（${match.reason}），保留在得到暂存区。`);
      continue;
    }

    try {
      await copyStageToAction(app, entry.staging_folder, match.target, detail);
      entry.status = "imported";
      entry.action_folder = match.target.folder;
      entry.imported_at = new Date().toISOString();
      await saveLedger(app, settings, ledger);
      summary.matched++;
      summary.notes.push(`${title}：转写/总结已拷贝到「${match.target.meta.title}」/素材，原始录音留在得到。`);
      progress.log(`匹配到：${match.target.meta.title}（${match.reason}），转写/总结已拷贝到素材/，原始录音留在得到。`);
      try {
        await addExternalId(app, match.target.folder, detail.id);
      } catch (error) {
        progress.log(`行动 frontmatter 写入 getnote_id 失败：${error instanceof Error ? error.message : String(error)}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.failed++;
      summary.errors.push(`${title}：拷贝转写/总结到行动素材失败 ${message}`);
      summary.notes.push(`${title}：拷贝转写/总结到行动素材失败 ${message}`);
      progress.log(`拷贝失败：${title}（${message}）`);
    }
  }

  if (summary.failed) {
    try {
      const diagnosticPath = `${importsRoot(settings)}/得到/上次同步错误.md`;
      await ensureFolder(app, diagnosticPath.split("/").slice(0, -1).join("/"));
      await writeText(
        app,
        diagnosticPath,
        [
          "# 上次得到同步错误",
          "",
          `生成时间：${new Date().toISOString()}`,
          "",
          `读取 ${summary.fetched}，暂存 ${summary.staged}，匹配 ${summary.matched}，待匹配 ${summary.pending}，跳过 ${summary.skipped}，失败 ${summary.failed}。`,
          "",
          "## 错误",
          "",
          ...(summary.errors.length ? summary.errors.map((error) => `- ${error}`) : ["（无）"]),
          "",
          "## 明细",
          "",
          ...summary.notes.map((note) => `- ${note}`),
          "",
        ].join("\n"),
      );
    } catch {
      /* 诊断文件写失败不影响同步结果 */
    }
  }

  try {
    await writeCatalog(app, settings, ledger, activities, summary.errors);
  } catch (error) {
    progress.log(`更新导入总目录失败：${error instanceof Error ? error.message : String(error)}`);
  }

  progress.status(
    `同步完成：读取 ${summary.fetched}，暂存 ${summary.staged}，匹配 ${summary.matched}，待匹配 ${summary.pending}，失败 ${summary.failed}。`,
  );
  return summary;
}
