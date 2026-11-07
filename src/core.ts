/**
 * 纯逻辑层：路径、分类、解析、上下文预算、AI 结果归一化。
 * 这里不 import Obsidian，方便用 Node 直接跑单测。
 */
import type {
  ActivityAssessment,
  ActivityMeta,
  ActivityType,
  ArtifactKind,
  AssessmentSettings,
  ContextBlock,
  EvidenceItem,
  GoalAnalysis,
  GoalProgress,
  GroupMeta,
  OverviewAssessment,
  SeriesMeta,
  StageAssessment,
  StudentAssessment,
} from "./types";
import { ACTIVITY_NOTE, ACTIONS_SUBFOLDER, FOLDERS, SUBFOLDERS } from "./types";

const AUDIO_EXTS = new Set(["mp3", "m4a", "wav", "aac", "ogg", "flac", "amr", "wma", "opus", "mpga"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "mkv", "avi", "webm", "m4v", "mpeg", "mpg"]);
const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "heif"]);
const TEXT_EXTS = new Set(["md", "markdown", "txt", "csv", "json"]);
const DOC_EXTS = new Set(["pdf", "docx", "doc", "pptx", "ppt", "xlsx", "xls"]);

export const DISCLAIMER =
  "本报告由 AI 辅助整理，导师确认后使用。每条结论都标注了素材来源；没有证据的地方写「未观察到」，不代表孩子不具备该素养。";

export function extOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

export function stemOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const idx = name.lastIndexOf(".");
  return idx > 0 ? name.slice(0, idx) : name;
}

export function classifyFile(path: string): ArtifactKind {
  const ext = extOf(path);
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (TEXT_EXTS.has(ext)) return "text";
  if (DOC_EXTS.has(ext)) return "document";
  return "other";
}

export function kindLabel(kind: ArtifactKind): string {
  switch (kind) {
    case "audio":
      return "录音";
    case "video":
      return "视频";
    case "image":
      return "图片";
    case "text":
      return "文字";
    case "document":
      return "文档";
    default:
      return "其他";
  }
}

export function mimeForFile(path: string): string {
  const ext = extOf(path);
  const map: Record<string, string> = {
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    wav: "audio/wav",
    aac: "audio/aac",
    ogg: "audio/ogg",
    flac: "audio/flac",
    amr: "audio/amr",
    wma: "audio/x-ms-wma",
    opus: "audio/opus",
    mpga: "audio/mpeg",
    mp4: "video/mp4",
    mov: "video/quicktime",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
    webm: "video/webm",
    m4v: "video/x-m4v",
    mpeg: "video/mpeg",
    mpg: "video/mpeg",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    heic: "image/heic",
    heif: "image/heif",
  };
  return map[ext] ?? "application/octet-stream";
}

export function sanitizeName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "");
  return (cleaned || "未命名").slice(0, 60);
}

export function hashString(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function makeActionId(date: string, title: string): string {
  const digits = date.replace(/\D/g, "") || todayISO().replace(/\D/g, "");
  return `act_${digits}_${hashString(title).slice(0, 6)}`;
}

export function activityFolderName(date: string, title: string): string {
  return `${date || todayISO()}_${sanitizeName(title)}`;
}

export function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(s)}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function splitFrontmatter(markdown: string): { frontmatter: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
  if (!match) return { frontmatter: "", body: markdown };
  return { frontmatter: match[1], body: markdown.slice(match[0].length) };
}

export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.search(/[{[]/);
  if (start < 0) return null;
  const open = cleaned[start];
  if (open !== "{" && open !== "[") return null;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return unique(value.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean));
  }
  if (typeof value === "string") {
    return splitList(value);
  }
  return [];
}

export function splitList(input: string): string[] {
  return unique(
    input
      .split(/[,，、;；\n]/)
      .map((s) => s.trim().replace(/^[-*•\d.)、\s]+/, "").trim())
      .filter(Boolean),
  );
}

export function parseParticipants(input: string): string[] {
  return splitList(input);
}

export function parseGoals(input: string): string[] {
  return unique(
    input
      .split(/\n/)
      .map((s) => s.trim().replace(/^[-*•\d.)、\s]+/, "").trim())
      .flatMap((s) => (s.includes("；") || s.includes(";") ? splitList(s) : [s]))
      .filter(Boolean),
  );
}

export function unique<T>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = typeof item === "string" ? item.toLowerCase() : JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function truncateMiddle(text: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  const marker = "\n…（中间省略）…\n";
  if (maxChars <= marker.length + 2) return text.slice(0, maxChars);
  const keep = maxChars - marker.length;
  const head = Math.ceil(keep * 0.6);
  const tail = keep - head;
  return text.slice(0, head) + marker + text.slice(text.length - tail);
}

export interface BuiltContext {
  text: string;
  used: number;
  omitted: number;
  truncated: boolean;
}

export function buildContext(blocks: ContextBlock[], maxChars: number): BuiltContext {
  const sorted = [...blocks].sort((a, b) => a.priority - b.priority);
  const parts: string[] = [];
  let used = 0;
  let omitted = 0;
  let truncated = false;
  for (const block of sorted) {
    const header = `\n\n--- 来源：${block.label} ---\n`;
    if (used + header.length >= maxChars) {
      omitted++;
      continue;
    }
    const remaining = maxChars - used - header.length;
    let text = block.text.trim();
    if (!text) {
      omitted++;
      continue;
    }
    if (text.length > remaining) {
      text = truncateMiddle(text, remaining);
      truncated = true;
    }
    parts.push(header + text);
    used += header.length + text.length;
    if (used >= maxChars) break;
  }
  return { text: parts.join(""), used, omitted, truncated };
}

export function resolveFrameworkPath(settings: AssessmentSettings): string {
  const raw = settings.frameworkPath.trim();
  if (raw) return raw;
  return `${settings.dataRoot}/${FOLDERS.framework}/素养框架.md`;
}

export const LEGACY_SERIES_FOLDER = "01_系列";

export function seriesRoot(settings: AssessmentSettings): string {
  return `${settings.dataRoot}/${FOLDERS.series}`;
}

/** 新库优先 01_项目；旧库继续读 01_系列。 */
export function seriesRoots(settings: AssessmentSettings): string[] {
  return [
    seriesRoot(settings),
    `${settings.dataRoot}/${LEGACY_SERIES_FOLDER}`,
  ];
}

export function groupRoot(settings: AssessmentSettings): string {
  return `${settings.dataRoot}/${FOLDERS.groups}`;
}

export function studentRoot(settings: AssessmentSettings): string {
  return `${settings.dataRoot}/${FOLDERS.students}`;
}

export function importsRoot(settings: AssessmentSettings): string {
  return `${settings.dataRoot}/${FOLDERS.imports}`;
}

export function seriesActionsFolder(seriesFolder: string): string {
  return `${seriesFolder}/${ACTIONS_SUBFOLDER}`;
}

export function activitySubfolder(activityFolder: string, sub: keyof typeof SUBFOLDERS): string {
  return `${activityFolder}/${SUBFOLDERS[sub]}`;
}

export function activityNotePath(activityFolder: string, title?: string): string {
  const name = title ? sanitizeName(title).replace(/\.md$/i, "").trim() : "";
  return name ? `${activityFolder}/${name}.md` : `${activityFolder}/${ACTIVITY_NOTE}`;
}

export function activityReportTitle(meta: ActivityMeta): string {
  const scope = meta.series.trim()
    ? `${meta.series.trim()} · ${meta.title.trim()}`
    : meta.title.trim() || "未命名行动";
  return `行动成长报告（${scope}）`;
}

export function activityReportFileName(meta: ActivityMeta): string {
  const scope = sanitizeName(meta.series.trim() ? `${meta.series.trim()} · ${meta.title}` : meta.title);
  return `行动成长报告（${scope}）.md`;
}

export function normalizeLevel(value: unknown): string {
  const raw = asString(value, "未判断").toUpperCase().replace(/\s+/g, "");
  if (/^L[1-7]$/.test(raw)) return raw;
  const match = /L([1-7])/.exec(raw);
  return match ? `L${match[1]}` : "未判断";
}

export function normalizeOrigin(value: unknown): "原文" | "推断" {
  const raw = asString(value);
  return /推断|推测|infer/i.test(raw) ? "推断" : "原文";
}

export function normalizeEvidence(value: unknown, fallbackStudent = ""): EvidenceItem {
  const r = asRecord(value);
  return {
    student: asString(r.student, fallbackStudent),
    goal: asString(r.goal, asString(r.objective, "未指定目标")),
    dimension: asString(r.dimension, asString(r.competency, "未指定维度")),
    level: normalizeLevel(r.level),
    quote: asString(r.quote, asString(r.evidence, "")),
    source: asString(r.source, asString(r.location, "未标注来源")),
    confidence: clamp(asNumber(r.confidence, 0.5), 0, 1),
    origin: normalizeOrigin(r.origin),
    note: asString(r.note) || undefined,
    photo: asString(r.photo) || undefined,
  };
}

export function seriesIdFor(name: string): string {
  const trimmed = name.trim();
  return trimmed ? `series_${hashString(trimmed).slice(0, 8)}` : "";
}

export function normalizeActivityType(value: string): ActivityType {
  const allowed: ActivityType[] = ["项目", "课程", "课堂", "活动", "行动", "其他"];
  return allowed.includes(value as ActivityType) ? (value as ActivityType) : "行动";
}

export function normalizeActivityMeta(raw: Record<string, unknown>, folder: string): ActivityMeta {
  const title = asString(raw.title) || folder.split(/[\\/]/).pop()?.replace(/^\d{4}-\d{2}-\d{2}_/, "") || "未命名行动";
  const type = normalizeActivityType(asString(raw.type, "行动"));
  const date = asString(raw.date) || todayISO();
  const series = asString(raw.series);
  const sequenceRaw = asNumber(raw.sequence, 0);
  return {
    action_id: asString(raw.action_id) || makeActionId(date, title),
    title,
    type,
    date,
    start_time: asString(raw.start_time),
    end_time: asString(raw.end_time),
    mentor: asString(raw.mentor),
    participants: asStringArray(raw.participants),
    goals: asStringArray(raw.goals),
    framework: asString(raw.framework),
    status: asString(raw.status, "收集中"),
    series,
    series_id: asString(raw.series_id) || seriesIdFor(series),
    sequence: sequenceRaw > 0 ? Math.round(sequenceRaw) : null,
    groups: asStringArray(raw.groups),
    getnote_ids: asStringArray(raw.getnote_ids),
  };
}

export function normalizeSeriesMeta(raw: Record<string, unknown>, folder: string): SeriesMeta {
  const title = asString(raw.title) || folder.split(/[\\/]/).pop() || "未命名系列";
  const typeRaw = asString(raw.series_type ?? raw.type, "项目");
  const type = typeRaw === "课程" || typeRaw === "活动群" || typeRaw === "其他" ? typeRaw : "项目";
  return {
    series_id: asString(raw.series_id) || seriesIdFor(title),
    title,
    type,
    mentor: asString(raw.mentor),
    description: asString(raw.description),
    goals: asStringArray(raw.goals),
    created_at: asString(raw.created_at, nowISO()),
    status: asString(raw.status, "进行中"),
  };
}

export function normalizeGroupMeta(raw: Record<string, unknown>, folder: string): GroupMeta {
  const name = asString(raw.name) || folder.split(/[\\/]/).pop() || "未命名小组";
  return {
    group_id: asString(raw.group_id) || `group_${hashString(name).slice(0, 8)}`,
    name,
    mentor: asString(raw.mentor),
    members: asStringArray(raw.members),
    series: asString(raw.series),
    description: asString(raw.description),
    created_at: asString(raw.created_at, nowISO()),
  };
}

export interface NoteMatchInput {
  title: string;
  transcript: string;
  /** ISO 时间，通常用得到笔记的 created_at */
  createdAt: string;
  /** 录音时长（秒）；没有就按 1 小时估算 */
  durationSec?: number;
}

export interface ActionMatch {
  action: ActivityMeta;
  score: number;
  timeScore: number;
  contentScore: number;
  reasons: string[];
}

export interface MatchDecision {
  best: ActionMatch | null;
  matches: ActionMatch[];
  confident: boolean;
}

export function parseTimeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function dateAtMinutes(date: string, minutes: number): Date | null {
  const parts = date.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return new Date(parts[0], parts[1] - 1, parts[2], Math.floor(minutes / 60), minutes % 60, 0, 0);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dayDistance(a: Date, b: Date): number {
  const dayA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const dayB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.abs(Math.round((dayA - dayB) / 86_400_000));
}

function matchTokens(value: string): string[] {
  return unique(
    value
      .split(/[\s,，、;；:：·\-—_/（）()【】\[\]]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2),
  );
}

export function commonSubstringLength(short: string, long: string): number {
  const a = short.toLowerCase();
  const b = long.toLowerCase().slice(0, 5000);
  let best = 0;
  let previous = new Array<number>(a.length + 1).fill(0);
  for (let j = 0; j < b.length; j++) {
    const current = new Array<number>(a.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
      if (a[i - 1] === b[j]) {
        current[i] = previous[i - 1] + 1;
        if (current[i] > best) best = current[i];
      }
    }
    previous = current;
  }
  return best;
}

export function matchNoteToActions(
  note: NoteMatchInput,
  actions: ActivityMeta[],
  options: { windowHours?: number } = {},
): ActionMatch[] {
  const noteStart = new Date(note.createdAt);
  if (!Number.isFinite(noteStart.getTime())) return [];
  const durationMs = Math.max(60, note.durationSec ?? 3600) * 1000;
  const noteEnd = new Date(noteStart.getTime() + durationMs);
  const windowMs = Math.max(1, options.windowHours ?? 6) * 3600_000;
  const text = `${note.title}\n${note.transcript.slice(0, 20_000)}`.toLowerCase();

  const matches: ActionMatch[] = [];
  for (const action of actions) {
    const actionDate = dateAtMinutes(action.date, 0);
    if (!actionDate) continue;
    const reasons: string[] = [];
    let timeScore = 0;

    const startMinutes = parseTimeToMinutes(action.start_time);
    const endMinutes = parseTimeToMinutes(action.end_time);
    if (startMinutes !== null) {
      const actionStart = dateAtMinutes(action.date, startMinutes);
      const actionEnd = dateAtMinutes(action.date, endMinutes ?? startMinutes + 60);
      if (actionStart && actionEnd) {
        const overlaps =
          noteStart.getTime() <= actionEnd.getTime() + windowMs &&
          noteEnd.getTime() >= actionStart.getTime() - windowMs;
        if (overlaps) {
          timeScore = 6;
          reasons.push("录音时间与行动时间窗重叠");
        } else if (sameDay(noteStart, actionStart)) {
          timeScore = 3;
          reasons.push("同一天");
        } else if (dayDistance(noteStart, actionStart) <= 1) {
          timeScore = 1;
          reasons.push("相邻日期");
        }
      }
    } else if (sameDay(noteStart, actionDate)) {
      timeScore = 3;
      reasons.push("同一天（行动未填时间）");
    } else if (dayDistance(noteStart, actionDate) <= 1) {
      timeScore = 1;
      reasons.push("相邻日期（行动未填时间）");
    }

    let contentScore = 0;
    for (const name of action.participants) {
      if (name.length >= 2 && text.includes(name.toLowerCase())) {
        contentScore += 3;
        reasons.push(`提到学员 ${name}`);
      }
    }
    const titleTokens = matchTokens(action.title);
    let titleHits = 0;
    for (const token of titleTokens) {
      if (text.includes(token.toLowerCase())) {
        titleHits++;
        contentScore += 1.5;
      }
    }
    if (titleHits) reasons.push(`标题关键词命中 ${titleHits} 个`);
    if (action.title.length >= 2 && text.includes(action.title.toLowerCase())) {
      contentScore += 3;
      reasons.push("正文提到行动名称");
    }
    const seriesText = action.series.trim().toLowerCase();
    if (seriesText) {
      if (text.includes(seriesText)) {
        contentScore += 3;
        reasons.push("正文提到系列名称");
      } else {
        const common = commonSubstringLength(seriesText, text);
        if (common >= 3) {
          contentScore += Math.min(6, common * 1.2);
          reasons.push(`系列名部分命中 ${common} 字`);
        }
      }
    }
    const goalTokens = unique(action.goals.flatMap((goal) => matchTokens(goal))).filter((token) => token.length >= 3);
    let goalHits = 0;
    for (const token of goalTokens) {
      if (text.includes(token.toLowerCase())) {
        goalHits++;
        contentScore += 0.5;
      }
    }
    if (goalHits) reasons.push(`目标关键词命中 ${goalHits} 个`);

    contentScore = Math.min(12, contentScore);
    const score = timeScore + contentScore;
    if (score > 0) {
      matches.push({ action, score, timeScore, contentScore, reasons });
    }
  }

  matches.sort((a, b) => b.score - a.score || a.action.date.localeCompare(b.action.date));
  return matches;
}

export function decideActionMatch(matches: ActionMatch[]): MatchDecision {
  const best = matches[0] ?? null;
  const second = matches[1];
  const confident = Boolean(best && best.score >= 6 && (!second || best.score - second.score >= 2));
  return { best, matches, confident };
}

export function groupActionsBySeries(actions: ActivityMeta[]): Array<{ id: string; name: string; actions: ActivityMeta[] }> {
  const groups = new Map<string, { id: string; name: string; actions: ActivityMeta[] }>();
  for (const action of actions) {
    const name = action.series.trim();
    if (!name) continue;
    const id = action.series_id || seriesIdFor(name);
    if (!groups.has(id)) groups.set(id, { id, name, actions: [] });
    groups.get(id)?.actions.push(action);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "zh"));
}

export function normalizeActivityAssessment(raw: unknown, meta: ActivityMeta, model: string): ActivityAssessment {
  const r = asRecord(raw);
  const studentsRaw = Array.isArray(r.students) ? r.students : [];
  const byStudent = new Map<string, StudentAssessment>();

  for (const item of studentsRaw) {
    const sr = asRecord(item);
    const name = asString(sr.student, asString(sr.name, ""));
    if (!name) continue;
    const evidenceRaw = Array.isArray(sr.evidence) ? sr.evidence : [];
    const evidence = evidenceRaw.map((e) => normalizeEvidence(e, name)).filter((e) => e.quote || e.source);
    byStudent.set(name, {
      student: name,
      summary: asString(sr.summary),
      evidence,
      strengths: asStringArray(sr.strengths),
      next_steps: asStringArray(sr.next_steps ?? sr.nextSteps),
      missing_evidence: asStringArray(sr.missing_evidence ?? sr.missingEvidence),
    });
  }

  for (const name of meta.participants) {
    if (!byStudent.has(name)) {
      byStudent.set(name, {
        student: name,
        summary: "本次材料中没有找到可核验的观察证据。",
        evidence: [],
        strengths: [],
        next_steps: [],
        missing_evidence: ["本次活动的素材未覆盖该学员，建议补充观察或下次跟进。"],
      });
    }
  }

  const goals = meta.goals.length ? meta.goals : ["（未填写教学目标）"];
  const goalRaw = Array.isArray(r.goal_analysis) ? r.goal_analysis : [];
  const goalAnalysis: GoalAnalysis[] = goalRaw.map((g) => {
    const gr = asRecord(g);
    return {
      goal: asString(gr.goal, "未指定目标"),
      coverage: asString(gr.coverage, "未判断"),
      comment: asString(gr.comment),
    };
  });
  for (const goal of goals) {
    if (!goalAnalysis.some((g) => g.goal === goal)) {
      goalAnalysis.push({ goal, coverage: "未判断", comment: "材料中未找到与该目标直接对应的证据。" });
    }
  }

  return {
    activity_id: meta.action_id,
    activity_title: meta.title,
    activity_series: meta.series,
    activity_type: meta.type,
    date: meta.date,
    mentor: meta.mentor,
    generated_at: nowISO(),
    model,
    overview: asString(r.overview, "本次活动的材料已整理，但整体概述未能生成，请导师补充。"),
    goal_analysis: goalAnalysis,
    students: [...byStudent.values()],
    mentor_suggestions: asStringArray(r.mentor_suggestions ?? r.mentorSuggestions),
    missing_evidence: asStringArray(r.missing_evidence ?? r.missingEvidence),
    evidence_photos: asStringArray(r.evidence_photos ?? r.evidencePhotos),
    disclaimer: DISCLAIMER,
  };
}

export function normalizeStageAssessment(raw: unknown, student: string, period: string, model: string): StageAssessment {
  const r = asRecord(raw);
  const progressRaw = Array.isArray(r.goal_progress) ? r.goal_progress : [];
  const goalProgress: GoalProgress[] = progressRaw.map((g) => {
    const gr = asRecord(g);
    return {
      goal: asString(gr.goal, "未指定目标"),
      level: normalizeLevel(gr.level),
      evidence_summary: asString(gr.evidence_summary ?? gr.evidenceSummary),
      trend: asString(gr.trend, "待观察"),
    };
  });
  const evidenceRaw = Array.isArray(r.evidence) ? r.evidence : [];
  return {
    student,
    period,
    generated_at: nowISO(),
    model,
    overview: asString(r.overview, "阶段性材料已整理，但整体概述未能生成。"),
    goal_progress: goalProgress,
    evidence: evidenceRaw.map((e) => normalizeEvidence(e, student)).filter((e) => e.quote || e.source),
    strengths: asStringArray(r.strengths),
    suggestions: asStringArray(r.suggestions),
    missing_evidence: asStringArray(r.missing_evidence ?? r.missingEvidence),
    disclaimer: DISCLAIMER,
  };
}

export function normalizeOverviewAssessment(
  raw: unknown,
  kind: "project_overview" | "term_overview",
  scope: string,
  period: string,
  model: string,
  participants: string[],
  actionCount: number,
): OverviewAssessment {
  const r = asRecord(raw);
  const studentRaw = Array.isArray(r.students) ? r.students : [];
  const byStudent = new Map<string, OverviewAssessment["students"][number]>();
  for (const item of studentRaw) {
    const sr = asRecord(item);
    const name = asString(sr.student, asString(sr.name, ""));
    if (!name) continue;
    const evidenceRaw = Array.isArray(sr.evidence) ? sr.evidence : [];
    byStudent.set(name, {
      student: name,
      summary: asString(sr.summary),
      highlights: asStringArray(sr.highlights),
      evidence: evidenceRaw.map((e) => normalizeEvidence(e, name)).filter((e) => e.quote || e.source),
    });
  }
  for (const name of participants) {
    if (!byStudent.has(name)) {
      byStudent.set(name, {
        student: name,
        summary: "本周期材料中没有找到该同学的可核验证据。",
        highlights: [],
        evidence: [],
      });
    }
  }
  const goalRaw = Array.isArray(r.goal_progress) ? r.goal_progress : [];
  const goalProgress: GoalProgress[] = goalRaw.map((g) => {
    const gr = asRecord(g);
    return {
      goal: asString(gr.goal, "未指定目标"),
      level: normalizeLevel(gr.level),
      evidence_summary: asString(gr.evidence_summary ?? gr.evidenceSummary),
      trend: asString(gr.trend, "待观察"),
    };
  });
  return {
    report_kind: kind,
    report_title: kind === "project_overview" ? "项目总报告" : "学期 / 学年总报告",
    scope,
    period,
    generated_at: nowISO(),
    model,
    overview: asString(r.overview, "周期材料已整理，但整体概述未能生成。"),
    participants,
    action_count: actionCount,
    goal_progress: goalProgress,
    highlights: asStringArray(r.highlights ?? r.key_findings ?? r.keyFindings),
    students: [...byStudent.values()],
    suggestions: asStringArray(r.suggestions),
    missing_evidence: asStringArray(r.missing_evidence ?? r.missingEvidence),
    evidence_photos: asStringArray(r.evidence_photos ?? r.evidencePhotos),
    disclaimer: DISCLAIMER,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function safeFilePart(value: string, fallback = "未命名"): string {
  return sanitizeName(value) || fallback;
}
