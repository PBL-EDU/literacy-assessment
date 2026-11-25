/**
 * 报告审核状态与 level 批准落盘。
 * 报告 Markdown 只记录状态摘要；完整审核决定放在同目录 *.审核.json。
 */
import type { App } from "obsidian";
import { TFile, normalizePath } from "obsidian";
import type {
  AssessmentSettings,
  LevelDecision,
  LevelProposal,
  QualitySummary,
  ReviewRecord,
  ReviewStatus,
  TeachingFeedback,
} from "./types";
import { nowISO } from "./core";
import { pathExists, readText, writeText } from "./vault";
import { applyLevelDecision } from "./profile";

export function reportReviewPath(reportPath: string): string {
  return `${reportPath.replace(/\.md$/i, "")}.审核.json`;
}

export function newReportId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export async function readReview(app: App, reportPath: string): Promise<ReviewRecord | null> {
  const path = reportReviewPath(reportPath);
  if (!(await pathExists(app, path))) return null;
  try {
    return JSON.parse(await readText(app, path)) as ReviewRecord;
  } catch {
    return null;
  }
}

export async function saveReview(app: App, reportPath: string, review: ReviewRecord): Promise<void> {
  await writeText(app, reportReviewPath(reportPath), `${JSON.stringify(review, null, 2)}\n`);
}

async function setReportFrontmatter(
  app: App,
  reportPath: string,
  values: Record<string, unknown>,
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(normalizePath(reportPath));
  if (!(file instanceof TFile)) return;
  await app.fileManager.processFrontMatter(file, (frontmatter) => {
    const data = frontmatter as Record<string, unknown>;
    Object.assign(data, values);
  });
}

export async function markReportPending(
  app: App,
  reportPath: string,
  reportKind: ReviewRecord["report_kind"],
  options: {
    quality?: QualitySummary;
    proposals?: LevelProposal[];
    feedback?: TeachingFeedback;
    actionTitle?: string;
    projectTitle?: string;
    participants?: string[];
  } = {},
): Promise<ReviewRecord> {
  const review: ReviewRecord = {
    report_id: newReportId("rpt"),
    report_path: reportPath,
    report_kind: reportKind,
    status: "pending_review",
    reviewer: "",
    reviewed_at: "",
    level_decisions: [],
    overall_decision: "pending",
    notes: "",
    quality_summary: options.quality,
    teaching_feedback: options.feedback,
    level_proposals: options.proposals,
    participants: options.participants,
  };
  await saveReview(app, reportPath, review);
  await setReportFrontmatter(app, reportPath, {
    report_id: review.report_id,
    review_status: "pending_review",
    reviewed_by: "",
    reviewed_at: "",
    review_version: 1,
  });
  // 重新生成后，旧对外版和 PDF 标记不能继续冒充“已批准”。
  try {
    const externalPath = reportPath.replace(/\.md$/i, "_对外.md");
    if (await pathExists(app, externalPath)) await app.vault.adapter.remove(normalizePath(externalPath));
    const pdfMarker = `${reportPath.split("/").slice(0, -1).join("/")}/.pdf-exported`;
    if (await pathExists(app, pdfMarker)) await app.vault.adapter.remove(normalizePath(pdfMarker));
  } catch {
    /* 旧文件删除失败不阻断生成；报告已经是待审核状态 */
  }
  return review;
}

export async function approveReport(
  app: App,
  settings: AssessmentSettings,
  reportPath: string,
  decisions: LevelDecision[],
  options: {
    reviewer: string;
    notes?: string;
    actionTitle?: string;
    projectTitle?: string;
    reportsLabel?: string;
  },
): Promise<ReviewRecord> {
  const review = (await readReview(app, reportPath)) ?? {
    report_id: newReportId("rpt"),
    report_path: reportPath,
    report_kind: "activity",
    status: "pending_review",
    reviewer: "",
    reviewed_at: "",
    level_decisions: [],
    overall_decision: "pending",
    notes: "",
  };
  const approved = decisions.filter(
    (decision) => decision.decision === "approved" || decision.decision === "modified",
  );
  for (const decision of approved) {
    await applyLevelDecision(app, settings, decision, {
      action: options.actionTitle,
      project: options.projectTitle,
      reportPath,
      reviewer: options.reviewer,
      challenge: decision.note,
    });
  }
  review.status = "approved";
  review.reviewer = options.reviewer;
  review.reviewed_at = nowISO();
  review.level_decisions = decisions;
  review.overall_decision = "approved";
  review.notes = options.notes ?? "";
  await saveReview(app, reportPath, review);
  await setReportFrontmatter(app, reportPath, {
    report_id: review.report_id,
    review_status: "approved",
    reviewed_by: review.reviewer,
    reviewed_at: review.reviewed_at,
    review_version: 1,
  });
  return review;
}

export async function requestChanges(
  app: App,
  reportPath: string,
  reviewer: string,
  notes: string,
): Promise<ReviewRecord> {
  const review = (await readReview(app, reportPath)) ?? {
    report_id: newReportId("rpt"),
    report_path: reportPath,
    report_kind: "activity",
    status: "changes_requested",
    reviewer,
    reviewed_at: nowISO(),
    level_decisions: [],
    overall_decision: "changes_requested",
    notes,
  };
  review.status = "changes_requested";
  review.reviewer = reviewer;
  review.reviewed_at = nowISO();
  review.overall_decision = "changes_requested";
  review.notes = notes;
  await saveReview(app, reportPath, review);
  await setReportFrontmatter(app, reportPath, {
    report_id: review.report_id,
    review_status: "changes_requested",
    reviewed_by: reviewer,
    reviewed_at: review.reviewed_at,
    review_version: 1,
  });
  return review;
}

export function isApproved(review: ReviewRecord | null): boolean {
  return review?.status === "approved";
}

export async function reviewStatusOf(app: App, reportPath: string): Promise<ReviewStatus> {
  const review = await readReview(app, reportPath);
  return review?.status ?? "legacy";
}
