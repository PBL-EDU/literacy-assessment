/**
 * 右侧栏：待办行动（按项目分组）+ 操作流程。
 */
import { ItemView, WorkspaceLeaf } from "obsidian";
import type { ActivityRecord, ArtifactKind } from "./types";
import { SUBFOLDERS } from "./types";
import { kindLabel } from "./core";
import { findActivityReportPath, listArtifacts, pathExists } from "./vault";
import type LiteracyAssessmentPlugin from "./main";

export const LITERACY_VIEW_TYPE = "literacy-assessment-view";

const ARCHIVED = "已归档";
const ORGANIZED_STATUSES = new Set(["已整理", "部分整理", "已生成报告"]);

export class LiteracyView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: LiteracyAssessmentPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return LITERACY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "素养评估";
  }

  getIcon(): string {
    return "clipboard-check";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  async render(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass("la-view");

    this.renderHeader(container);

    const activities = (await this.plugin.getActivities()).filter(
      (activity) => activity.meta.status !== ARCHIVED,
    );
    if (!activities.length) {
      const empty = container.createEl("div", { cls: "la-empty" });
      empty.setText("没有进行中的行动。点「新建行动」创建一次课堂/活动，或到文件目录查看已归档行动。");
      return;
    }

    const projects = new Map<string, ActivityRecord[]>();
    for (const activity of activities) {
      const project = activity.meta.series.trim() || "暂不归属";
      const list = projects.get(project) ?? [];
      list.push(activity);
      projects.set(project, list);
    }

    const projectNames = [...projects.keys()].sort((a, b) => {
      if (a === "暂不归属") return 1;
      if (b === "暂不归属") return -1;
      return a.localeCompare(b, "zh");
    });

    for (const [index, projectName] of projectNames.entries()) {
      await this.renderProject(container, projectName, projects.get(projectName) ?? [], index + 1);
    }
  }

  private renderHeader(container: HTMLElement): void {
    const header = container.createEl("div", { cls: "la-header" });
    const titleBox = header.createEl("div", { cls: "la-title-box" });
    titleBox.createEl("div", { cls: "la-title", text: "素养评估" });
    titleBox.createEl("div", { cls: "la-sub", text: "项目 → 行动 → 素材与报告" });

    const refresh = header.createEl("button", { cls: "la-icon-btn", text: "↻" });
    refresh.title = "刷新";
    refresh.onclick = () => void this.render();

    const toolbar = container.createEl("div", { cls: "la-toolbar" });
    const actionGroup = this.createToolGroup(toolbar, "行动");
    const newProject = actionGroup.createEl("button", { cls: "la-btn", text: "新建项目" });
    newProject.onclick = () => this.plugin.openCreateSeries();
    const newAction = actionGroup.createEl("button", { cls: "la-btn primary", text: "新建行动" });
    newAction.onclick = () => this.plugin.openCreateActivity();

    const peopleGroup = this.createToolGroup(toolbar, "人");
    const newGroup = peopleGroup.createEl("button", { cls: "la-btn", text: "新建小组" });
    newGroup.onclick = () => this.plugin.openCreateGroup();
    const newStudent = peopleGroup.createEl("button", { cls: "la-btn", text: "新建同学" });
    newStudent.onclick = () => this.plugin.openCreateStudent();

    const manageGroup = this.createToolGroup(toolbar, "管理");
    const sync = manageGroup.createEl("button", { cls: "la-btn", text: "同步得到" });
    sync.onclick = () => void this.plugin.runGetnoteSync();
    const catalog = manageGroup.createEl("button", { cls: "la-btn", text: "查看导入" });
    catalog.onclick = () => void this.plugin.openGetnoteCatalog();
    const termReport = manageGroup.createEl("button", { cls: "la-btn", text: "学期总报告" });
    termReport.onclick = () => void this.plugin.runTermOverview();

    container.createEl("div", {
      cls: "la-sub",
      text: "只显示进行中的行动；归档后从列表隐藏。",
    });
  }

  private createToolGroup(parent: HTMLElement, label: string): HTMLElement {
    const group = parent.createEl("div", { cls: "la-tool-group" });
    group.createEl("div", { cls: "la-tool-label", text: label });
    const buttons = group.createEl("div", { cls: "la-tool-buttons" });
    return buttons;
  }

  private async renderProject(
    container: HTMLElement,
    projectName: string,
    activities: ActivityRecord[],
    projectIndex: number,
  ): Promise<void> {
    const section = container.createEl("div", { cls: "la-project" });
    const header = section.createEl("div", { cls: "la-project-header" });
    const titleBox = header.createEl("div", { cls: "la-project-title-box" });
    const indexLabel = projectName === "暂不归属" ? "—" : String(projectIndex).padStart(2, "0");
    titleBox.createEl("div", { cls: "la-project-index", text: indexLabel });
    titleBox.createEl("div", { cls: "la-project-title", text: projectName });
    titleBox.createEl("div", {
      cls: "la-project-meta",
      text: `${activities.length} 个进行中的行动`,
    });

    if (projectName !== "暂不归属") {
      const report = header.createEl("button", { cls: "la-btn", text: "项目报告" });
      report.onclick = () => void this.plugin.runSeriesReport(projectName);
      const overview = header.createEl("button", { cls: "la-btn", text: "项目总览" });
      overview.onclick = () => void this.plugin.runProjectOverview(projectName);
    }

    const body = section.createEl("div", { cls: "la-project-body" });
    for (const [index, activity] of activities.entries()) {
      await this.renderAction(body, activity, `${indexLabel}.${index + 1}`);
    }
  }

  private async renderAction(container: HTMLElement, activity: ActivityRecord, sequence: string): Promise<void> {
    const card = container.createEl("div", { cls: "la-card la-action-card" });
    card.createEl("div", { cls: "la-action-seq", text: sequence });
    const title = card.createEl("div", { cls: "la-card-title", text: activity.meta.title });
    title.onclick = () => void this.plugin.openActivity(activity);

    card.createEl("div", {
      cls: "la-meta",
      text: `${activity.meta.type} · ${activity.meta.date} · ${activity.meta.mentor || "未填导师"}`,
    });

    const artifacts = await listArtifacts(this.app, activity.folder);
    const reportPath = (await findActivityReportPath(this.app, activity)) ?? "";
    const manifestPath = `${activity.folder}/素材清单.md`;
    const pdfMarkerPath = `${activity.folder}/${SUBFOLDERS.reports}/.pdf-exported`;
    const externalReportPath = reportPath ? reportPath.replace(/\.md$/i, "_对外.md") : "";
    const [hasReport, hasManifest, pdfExported, hasExternalReport] = await Promise.all([
      Promise.resolve(Boolean(reportPath)),
      pathExists(this.app, manifestPath),
      pathExists(this.app, pdfMarkerPath),
      externalReportPath ? pathExists(this.app, externalReportPath) : Promise.resolve(false),
    ]);

    const countByKind = new Map<ArtifactKind, number>();
    for (const artifact of artifacts) {
      countByKind.set(artifact.kind, (countByKind.get(artifact.kind) ?? 0) + 1);
    }
    const kindText = [...countByKind.entries()]
      .map(([kind, count]) => `${kindLabel(kind)} ${count}`)
      .join(" · ");

    const chips = card.createEl("div", { cls: "la-chips" });
    if (activity.meta.groups.length) {
      chips.createEl("span", { cls: "la-chip", text: `小组 ${activity.meta.groups.length}` });
    }
    chips.createEl("span", { cls: "la-chip", text: `素材 ${artifacts.length}` });
    if (kindText) chips.createEl("span", { cls: "la-chip", text: kindText });
    chips.createEl("span", { cls: "la-chip", text: `同学 ${activity.meta.participants.length}` });
    chips.createEl("span", { cls: "la-chip", text: `目标 ${activity.meta.goals.length}` });
    chips.createEl("span", {
      cls: hasReport ? "la-chip ok" : "la-chip warn",
      text: hasReport ? "报告 ✓" : "未生成报告",
    });
    if (pdfExported) chips.createEl("span", { cls: "la-chip ok", text: "PDF ✓" });
    if (hasExternalReport) {
      const externalChip = chips.createEl("span", { cls: "la-chip ok la-chip-link", text: "对外版 ✓" });
      externalChip.onclick = () => void this.plugin.openPath(externalReportPath);
    }

    const hasMedia = artifacts.some((artifact) =>
      artifact.kind === "audio" || artifact.kind === "video" || artifact.kind === "image" || artifact.kind === "document",
    );
    const organized = ORGANIZED_STATUSES.has(activity.meta.status) || hasReport;
    const canOrganize = hasManifest && hasMedia;
    const canReport = hasManifest && (!hasMedia || organized);
    const canArchive = hasReport && pdfExported;

    const actions = card.createEl("div", { cls: "la-row-actions" });
    this.addStepButton(actions, "1 查看", true, "打开行动笔记", () => void this.plugin.openActivity(activity));
    this.addStepButton(actions, "2 扫描", true, "扫描素材，生成素材清单", () => void this.plugin.runScan(activity));
    this.addStepButton(
      actions,
      "3 AI 整理",
      canOrganize,
      hasManifest ? (hasMedia ? "待整理素材" : "没有需要整理的素材") : "先完成第 2 步：扫描",
      () => void this.plugin.runOrganize(activity),
    );
    this.addStepButton(
      actions,
      "4 生成报告",
      canReport,
      canReport ? "生成活动成长报告" : hasMedia ? "先完成第 3 步：AI 整理" : "先完成第 2 步：扫描",
      () => void this.plugin.runReport(activity),
    );
    this.addStepButton(
      actions,
      "5 PDF",
      hasReport,
      hasReport ? "导出报告 PDF" : "先完成第 4 步：生成报告",
      () => {
        if (reportPath) void this.plugin.exportPdf(reportPath);
      },
    );
    this.addStepButton(
      actions,
      "6 归档",
      canArchive,
      canArchive ? "归档后从列表中隐藏" : "先完成第 4 步生成报告、第 5 步导出 PDF",
      () => void this.plugin.archiveActivity(activity),
    );
  }

  private addStepButton(
    parent: HTMLElement,
    label: string,
    enabled: boolean,
    hint: string,
    onClick: () => void,
  ): void {
    const button = parent.createEl("button", { cls: "la-btn la-step", text: label });
    button.disabled = !enabled;
    button.title = hint;
    if (enabled) button.onclick = onClick;
  }
}
