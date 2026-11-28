/**
 * 共享类型与默认设置。纯类型/常量，不依赖 Obsidian，便于单测。
 */

export type ActivityType = "项目" | "课程" | "课堂" | "活动" | "行动" | "其他";
export type SeriesType = "项目" | "课程" | "活动群" | "其他";

export type ArtifactKind = "audio" | "video" | "image" | "text" | "document" | "other";

export type FrameworkRole = "primary" | "supplementary";

export interface FrameworkRef {
  id: string;
  role: FrameworkRole;
  source?: TargetSource;
}

export interface FrameworkLevel {
  key: string;
  label: string;
}

export interface FrameworkGoal {
  id: string;
  title: string;
  dimension: string;
  path?: string;
  pathSegments?: string[];
  levels: Record<string, string>;
}

export type TargetSource = "tenant" | "team" | "personal";

export interface TargetRef {
  /** 旧数据没有 kind，默认按 framework 处理 */
  kind?: "framework" | "custom";
  source?: TargetSource;
  frameworkId: string;
  frameworkName: string;
  frameworkVersion: string;
  goalId: string;
  path: string;
  title: string;
  /** 框架目标的期望 level；必须是框架 level key */
  expectedLevel?: string;
  /** 自定义目标的说明 */
  description?: string;
  /** 自定义目标的自由文本期望 */
  expectedLevelText?: string;
  /** 行动从项目继承的目标标记 */
  inheritedFrom?: "project";
}

export interface StudentTargetOverride {
  targetKey: string;
  expectedLevel?: string;
  expectedLevelText?: string;
  reason?: string;
}

export interface FrameworkDefinition {
  id: string;
  name: string;
  version: string;
  status: string;
  path: string;
  hash: string;
  levels: FrameworkLevel[];
  goals: FrameworkGoal[];
  errors: string[];
  mandatory: boolean;
  orgId: string;
  source?: TargetSource;
}

export interface QualitySummary {
  source_count: number;
  goal_count: number;
  low_confidence_count: number;
  unverified_source_count: number;
  contradiction_count: number;
  gaps: string[];
  scale_checks: Array<{
    goal: string;
    requirement: string;
    met: "true" | "false" | "unknown";
    reason: string;
  }>;
}

export interface LevelProposal {
  student: string;
  framework_id: string;
  framework_name: string;
  goal: string;
  goal_title: string;
  current_level: string;
  proposed_level: string;
  confidence: number;
  scale_requirement: string;
  met: "true" | "false" | "unknown";
  evidence_refs: string[];
  reason: string;
  context_note: string;
}

export interface TeachingFeedback {
  leading: string[];
  evidence_collection: string[];
  next_observation: string[];
}

export type ReviewStatus = "draft" | "pending_review" | "approved" | "changes_requested" | "legacy";

export interface LevelDecision {
  student: string;
  framework_id: string;
  goal: string;
  current_level: string;
  proposed_level: string;
  final_level: string;
  decision: "approved" | "kept" | "modified" | "deferred";
  note: string;
  decided_at: string;
}

export interface ReviewRecord {
  report_id: string;
  report_path: string;
  report_kind: "activity" | "stage" | "series" | "overview";
  status: ReviewStatus;
  reviewer: string;
  reviewed_at: string;
  level_decisions: LevelDecision[];
  overall_decision: "approved" | "changes_requested" | "pending";
  notes: string;
  quality_summary?: QualitySummary;
  teaching_feedback?: TeachingFeedback;
  level_proposals?: LevelProposal[];
  participants?: string[];
}

export interface AssessmentSettings {
  dataRoot: string;
  frameworkPath: string;

  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
  aiTemperature: number;
  aiMaxTokens: number;
  aiTimeoutMs: number;

  asrEnabled: boolean;
  asrProvider: "openai" | "deepseek";
  asrBaseUrl: string;
  asrApiKey: string;
  asrModel: string;
  asrLanguage: string;

  ocrEnabled: boolean;
  ocrBaseUrl: string;
  ocrApiKey: string;
  ocrPurpose: "text_recognition" | "rich_layout_recognition";

  visionEnabled: boolean;
  visionModel: string;
  visionMaxImages: number;

  getnoteApiBase: string;
  getnoteApiKey: string;
  getnoteClientId: string;
  getnoteSource: "all" | "getseed" | "vendor_moan" | "dedao";
  getnoteSyncDays: number;
  getnoteMatchHours: number;
  getnoteDownloadAudio: boolean;

  maxContextChars: number;
  confirmBeforeUpload: boolean;
  autoOpenReport: boolean;

  /** 组织版 v0.5：服务端与设备会话 */
  orgServerUrl: string;
  orgRefreshToken: string;
  orgName: string;
  orgMemberName: string;
  orgTeamName: string;
  orgMemberId: string;
}

export const DEFAULT_SETTINGS: AssessmentSettings = {
  dataRoot: "白日梦行动",
  frameworkPath: "白日梦行动/00_框架/素养框架.md",

  aiBaseUrl: "https://api.deepseek.com/v1",
  aiApiKey: "",
  aiModel: "deepseek-chat",
  aiTemperature: 0.3,
  aiMaxTokens: 4096,
  aiTimeoutMs: 120_000,

  asrEnabled: true,
  asrProvider: "openai",
  asrBaseUrl: "https://api.openai.com/v1",
  asrApiKey: "",
  asrModel: "whisper-1",
  asrLanguage: "zh",

  ocrEnabled: true,
  ocrBaseUrl: "https://api.deepseek.com/v1",
  ocrApiKey: "",
  ocrPurpose: "text_recognition",

  visionEnabled: true,
  visionModel: "deepseek-flash",
  visionMaxImages: 20,

  getnoteApiBase: "https://openapi.biji.com/open/api/v1",
  getnoteApiKey: "",
  getnoteClientId: "",
  getnoteSource: "all",
  getnoteSyncDays: 7,
  getnoteMatchHours: 6,
  getnoteDownloadAudio: true,

  maxContextChars: 60_000,
  confirmBeforeUpload: true,
  autoOpenReport: true,

  orgServerUrl: "https://action.dreamook.com",
  orgRefreshToken: "",
  orgName: "",
  orgMemberName: "",
  orgTeamName: "",
  orgMemberId: "",
};

export const FOLDERS = {
  framework: "00_框架",
  series: "01_项目",
  groups: "02_小组",
  students: "03_学员",
  templates: "04_模板",
  imports: "05_导入",
  reports: "06_报告",
} as const;

export const ACTIONS_SUBFOLDER = "行动";

export const SUBFOLDERS = {
  materials: "素材",
  observations: "观察",
  transcripts: "转写",
  evidence: "证据",
  reports: "报告",
} as const;

export const ACTIVITY_NOTE = "行动.md";
export const SERIES_NOTE = "系列.md";
export const GROUP_NOTE = "小组.md";
export const STUDENT_NOTE = "学员.md";
export const MATERIAL_LIST_NOTE = "素材清单.md";
export const IMAGE_NOTES_NOTE = "图像说明.md";
export const EVIDENCE_JSON = "证据.json";
export const EVIDENCE_NOTE = "证据.md";
export const ACTIVITY_REPORT_NOTE = "活动成长报告.md";

export interface ActivityMeta {
  action_id: string;
  title: string;
  type: ActivityType;
  date: string;
  start_time: string;
  end_time: string;
  mentor: string;
  participants: string[];
  goals: string[];
  framework: string;
  framework_refs?: FrameworkRef[];
  targets?: TargetRef[];
  student_targets?: Record<string, StudentTargetOverride[]>;
  plan_id?: string;
  status: string;
  /** 所属系列/项目/课程名称 */
  series: string;
  series_id: string;
  sequence: number | null;
  /** 参与小组；participants 已包含小组成员 */
  groups: string[];
  /** 已导入的得到大脑笔记 ID，用于防重复 */
  getnote_ids: string[];
}

export interface SeriesMeta {
  series_id: string;
  title: string;
  type: SeriesType;
  mentor: string;
  description: string;
  goals: string[];
  framework_refs?: FrameworkRef[];
  targets?: TargetRef[];
  student_targets?: Record<string, StudentTargetOverride[]>;
  plan_id?: string;
  created_at: string;
  status: string;
}

export interface SeriesRecord {
  folder: string;
  notePath: string;
  meta: SeriesMeta;
  body: string;
}

export interface NewSeriesInput {
  title: string;
  type: SeriesType;
  mentor: string;
  description: string;
  goalsText: string;
  framework_refs?: FrameworkRef[];
  targets?: TargetRef[];
  plan_id?: string;
}

export interface GroupMeta {
  group_id: string;
  name: string;
  mentor: string;
  members: string[];
  series: string;
  description: string;
  created_at: string;
}

export interface GroupRecord {
  folder: string;
  notePath: string;
  meta: GroupMeta;
  body: string;
}

export interface NewGroupInput {
  name: string;
  mentor: string;
  membersText: string;
  series: string;
  description: string;
}

export interface ActivityRecord {
  folder: string;
  /** 行动笔记文件的 vault 相对路径；文件名使用行动名称 */
  notePath: string;
  meta: ActivityMeta;
  body: string;
}

export interface NewActivityInput {
  title: string;
  type: ActivityType;
  date: string;
  startTime: string;
  endTime: string;
  mentor: string;
  participantsText: string;
  goalsText: string;
  series: string;
  sequence: string;
  groups: string[];
  framework_refs?: FrameworkRef[];
  targets?: TargetRef[];
  student_targets?: Record<string, StudentTargetOverride[]>;
  plan_id?: string;
}

export interface ArtifactInfo {
  /** 相对 vault 的完整路径 */
  path: string;
  /** 文件名（含扩展名） */
  name: string;
  /** 不含扩展名的名字 */
  stem: string;
  kind: ArtifactKind;
  size: number;
  mtime: number;
  hasTranscript: boolean;
  hasDescription: boolean;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptResult {
  text: string;
  segments: TranscriptSegment[];
  language?: string;
  duration?: number;
  model: string;
}

export interface EvidenceItem {
  student: string;
  goal: string;
  dimension: string;
  level: string;
  quote: string;
  source: string;
  confidence: number;
  origin: "原文" | "推断";
  note?: string;
  /** 证据照片路径（相对 vault，如 素材/xxx.jpg） */
  photo?: string;
}

export interface StudentAssessment {
  student: string;
  summary: string;
  evidence: EvidenceItem[];
  strengths: string[];
  next_steps: string[];
  missing_evidence: string[];
}

export interface GoalAnalysis {
  goal: string;
  coverage: string;
  comment: string;
}

export interface ActivityAssessment {
  activity_id: string;
  activity_title: string;
  activity_series?: string;
  activity_type: string;
  date: string;
  mentor: string;
  generated_at: string;
  model: string;
  overview: string;
  goal_analysis: GoalAnalysis[];
  students: StudentAssessment[];
  mentor_suggestions: string[];
  missing_evidence: string[];
  /** 报告附带的证据照片（相对 vault） */
  evidence_photos?: string[];
  quality_summary?: QualitySummary;
  level_proposals?: LevelProposal[];
  teaching_feedback?: TeachingFeedback;
  framework_refs?: FrameworkRef[];
  targets?: TargetRef[];
  student_targets?: Record<string, StudentTargetOverride[]>;
  student_current_levels?: Record<string, Record<string, string>>;
  framework_versions?: string[];
  framework_hashes?: string[];
  disclaimer: string;
}

export interface GoalProgress {
  goal: string;
  level: string;
  evidence_summary: string;
  trend: string;
}

export interface StageAssessment {
  student: string;
  period: string;
  report_kind?: "stage" | "series";
  report_title?: string;
  generated_at: string;
  model: string;
  overview: string;
  goal_progress: GoalProgress[];
  evidence: EvidenceItem[];
  strengths: string[];
  suggestions: string[];
  missing_evidence: string[];
  quality_summary?: QualitySummary;
  level_proposals?: LevelProposal[];
  teaching_feedback?: TeachingFeedback;
  framework_refs?: FrameworkRef[];
  framework_versions?: string[];
  framework_hashes?: string[];
  disclaimer: string;
}

export interface OverviewStudentSection {
  student: string;
  summary: string;
  highlights: string[];
  evidence: EvidenceItem[];
}

export interface OverviewAssessment {
  report_kind: "project_overview" | "term_overview";
  report_title: string;
  scope: string;
  period: string;
  generated_at: string;
  model: string;
  overview: string;
  participants: string[];
  action_count: number;
  goal_progress: GoalProgress[];
  highlights: string[];
  students: OverviewStudentSection[];
  suggestions: string[];
  missing_evidence: string[];
  evidence_photos?: string[];
  quality_summary?: QualitySummary;
  level_proposals?: LevelProposal[];
  teaching_feedback?: TeachingFeedback;
  framework_refs?: FrameworkRef[];
  framework_versions?: string[];
  framework_hashes?: string[];
  disclaimer: string;
}

export interface StudentProfile {
  name: string;
  alias: string;
  notePath: string;
}

export interface ContextBlock {
  label: string;
  text: string;
  /** 越小越优先保留 */
  priority: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
