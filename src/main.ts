/**
 * 素养评估 · Obsidian 插件入口。
 */
import { MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import type { ActivityRecord, AssessmentSettings, NewActivityInput } from "./types";
import { ACTIONS_SUBFOLDER, DEFAULT_SETTINGS, FOLDERS } from "./types";
import {
  createActivity,
  createGroup,
  createSeries,
  createStudentProfile,
  ensureDataStructure,
  findStudentNote,
  listActivities,
  listArtifacts,
  listGroups,
  listSeriesRecords,
  normalizeEntityFilenames,
  openFile,
  pathExists,
  readActivity,
  syncAllRelations,
  updateActivityStatus,
  writeText,
} from "./vault";
import { organizeActivity, scanActivity } from "./organize";
import { assessActivity } from "./assess";
import {
  generateProjectOverviewReport,
  generateSeriesReport,
  generateStageReport,
  generateTermOverviewReport,
  listStudents,
} from "./stage";
import { LiteracyView, LITERACY_VIEW_TYPE } from "./view";
import { LiteracySettingTab } from "./settings";
import {
  ConfirmUploadModal,
  NewActivityModal,
  NewGroupModal,
  NewSeriesModal,
  NewStudentModal,
  OverviewReportModal,
  ProgressModal,
  SeriesReportModal,
  StageReportModal,
  type ActivityFormOptions,
} from "./modal";
import { testConnection } from "./ai";
import { groupActionsBySeries, LEGACY_SERIES_FOLDER, resolveFrameworkPath, unique } from "./core";
import { importGetnoteRecordings } from "./ingest";
import { testGetnoteConnection as testGetnote } from "./getnote";

export default class LiteracyAssessmentPlugin extends Plugin {
  settings: AssessmentSettings = { ...DEFAULT_SETTINGS };
  private initialized = false;
  private getnoteSyncRunning = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new LiteracySettingTab(this.app, this));
    this.registerView(LITERACY_VIEW_TYPE, (leaf) => new LiteracyView(leaf, this));

    this.addRibbonIcon("clipboard-check", "打开素养评估", () => void this.activateView());

    this.addCommand({ id: "open-panel", name: "打开素养评估面板", callback: () => void this.activateView() });
    this.addCommand({ id: "create-series", name: "新建项目", callback: () => this.openCreateSeries() });
    this.addCommand({ id: "create-group", name: "新建小组", callback: () => this.openCreateGroup() });
    this.addCommand({ id: "create-student", name: "新建同学", callback: () => this.openCreateStudent() });
    this.addCommand({ id: "create-activity", name: "新建行动", callback: () => this.openCreateActivity() });
    this.addCommand({
      id: "scan-active",
      name: "扫描当前行动的素材",
      callback: () => void this.runOnActive((record) => this.runScan(record)),
    });
    this.addCommand({
      id: "organize-active",
      name: "AI 整理当前行动（转写/图像说明）",
      callback: () => void this.runOnActive((record) => this.runOrganize(record)),
    });
    this.addCommand({
      id: "report-active",
      name: "生成当前活动的成长报告",
      callback: () => void this.runOnActive((record) => this.runReport(record)),
    });
    this.addCommand({ id: "stage-report", name: "生成阶段性成长报告", callback: () => void this.runStageReport() });
    this.addCommand({ id: "series-report", name: "生成项目报告", callback: () => void this.runSeriesReport() });
    this.addCommand({ id: "term-overview", name: "生成学期/学年总报告", callback: () => void this.runTermOverview() });
    this.addCommand({ id: "getnote-sync", name: "同步得到录音", callback: () => void this.runGetnoteSync() });
    this.addCommand({
      id: "getnote-catalog",
      name: "查看得到导入",
      callback: () => void this.openGetnoteCatalog(),
    });
    this.addCommand({ id: "export-pdf", name: "导出当前报告为 PDF", callback: () => void this.exportActiveReportPdf() });
    this.addCommand({ id: "sync-links", name: "同步双链关系", callback: () => void this.syncRelations() });
    this.addCommand({
      id: "normalize-filenames",
      name: "规范化实体文件名（旧库迁移）",
      callback: () => void this.normalizeFilenames(),
    });
    this.addCommand({ id: "create-folders", name: "创建数据目录结构", callback: () => void this.createDataStructure() });
    this.addCommand({ id: "test-ai", name: "测试 AI 连接", callback: () => void this.testAiConnectionNotice() });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile)) return;
        if (this.isReportPath(file.path)) {
          menu.addItem((item) =>
            item
              .setTitle("素养评估：导出为 PDF")
              .setIcon("file-down")
              .onClick(() => void this.exportPdf(file.path)),
          );
        }
        const folder = this.activityFolderOfPath(file.path);
        if (!folder) return;
        menu.addSeparator();
        menu.addItem((item) =>
          item
            .setTitle("素养评估：扫描素材")
            .setIcon("scan")
            .onClick(() => void this.runFolder(folder, (record) => this.runScan(record))),
        );
        menu.addItem((item) =>
          item
            .setTitle("素养评估：AI 整理")
            .setIcon("sparkles")
            .onClick(() => void this.runFolder(folder, (record) => this.runOrganize(record))),
        );
        menu.addItem((item) =>
          item
            .setTitle("素养评估：生成活动报告")
            .setIcon("file-text")
            .onClick(() => void this.runFolder(folder, (record) => this.runReport(record))),
        );
      }),
    );

    this.app.workspace.onLayoutReady(() => {
      if (this.initialized) return;
      this.initialized = true;
      void this.createDataStructure(true);
    });
  }

  onunload(): void {
    // Obsidian restores registered views to their previous location. Do not
    // detach leaves here; detaching resets user-moved leaves.
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<AssessmentSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /* ---------------- 视图 ---------------- */

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(LITERACY_VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) {
        new Notice("无法打开右侧栏。");
        return;
      }
      await leaf.setViewState({ type: LITERACY_VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(LITERACY_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof LiteracyView) void view.render();
    }
  }

  async getActivities(): Promise<ActivityRecord[]> {
    return listActivities(this.app, this.settings);
  }

  async openActivity(record: ActivityRecord): Promise<void> {
    await openFile(this.app, record.notePath);
  }

  async openPath(path: string): Promise<void> {
    await openFile(this.app, path);
  }

  openCreateSeries(): void {
    new NewSeriesModal(this.app, (input) => {
      void (async () => {
        try {
          const record = await createSeries(this.app, this.settings, input);
          new Notice(`已创建项目：${record.meta.title}`);
          await syncAllRelations(this.app, this.settings);
          await openFile(this.app, record.notePath);
          this.refreshViews();
        } catch (error) {
          new Notice(`创建项目失败：${error instanceof Error ? error.message : String(error)}`, 8000);
        }
      })();
    }).open();
  }

  openCreateGroup(): void {
    void (async () => {
      const series = await listSeriesRecords(this.app, this.settings);
      const students = await listStudents(this.app, this.settings);
      new NewGroupModal(
        this.app,
        series.map((item) => item.meta.title),
        students,
        (input) => {
          void (async () => {
            try {
              const record = await createGroup(this.app, this.settings, input);
              new Notice(`已创建小组：${record.meta.name}`);
              await syncAllRelations(this.app, this.settings);
              await openFile(this.app, record.notePath);
              this.refreshViews();
            } catch (error) {
              new Notice(`创建小组失败：${error instanceof Error ? error.message : String(error)}`, 8000);
            }
          })();
        },
      ).open();
    })();
  }

  openCreateStudent(): void {
    new NewStudentModal(this.app, (name) => {
      void (async () => {
        try {
          const folder = await createStudentProfile(this.app, this.settings, name);
          const notePath = await findStudentNote(this.app, folder);
          new Notice(`已创建同学：${name}`);
          if (notePath) await openFile(this.app, notePath);
          this.refreshViews();
        } catch (error) {
          new Notice(`创建同学失败：${error instanceof Error ? error.message : String(error)}`, 8000);
        }
      })();
    }).open();
  }

  openCreateActivity(): void {
    void (async () => {
      const options = await this.buildActivityOptions();
      new NewActivityModal(this.app, options, (input: NewActivityInput) => {
        void (async () => {
          try {
            const record = await createActivity(this.app, this.settings, input);
            new Notice(`已创建：${record.meta.title}`);
            await syncAllRelations(this.app, this.settings);
            await this.openActivity(record);
            this.refreshViews();
          } catch (error) {
            new Notice(`创建失败：${error instanceof Error ? error.message : String(error)}`, 8000);
          }
        })();
      }).open();
    })();
  }

  private async buildActivityOptions(): Promise<ActivityFormOptions> {
    const [seriesRecords, groupRecords, students, activities] = await Promise.all([
      listSeriesRecords(this.app, this.settings),
      listGroups(this.app, this.settings),
      listStudents(this.app, this.settings),
      this.getActivities(),
    ]);
    const series = seriesRecords.map((item) => ({
      name: item.meta.title,
      count: activities.filter((activity) => activity.meta.series === item.meta.title).length,
    }));
    for (const activity of activities) {
      if (activity.meta.series && !series.some((item) => item.name === activity.meta.series)) {
        series.push({ name: activity.meta.series, count: 1 });
      }
    }
    const goals = unique([
      ...seriesRecords.flatMap((item) => item.meta.goals),
      ...activities.flatMap((activity) => activity.meta.goals),
    ]);
    return {
      series,
      groups: groupRecords.map((item) => ({ name: item.meta.name, members: item.meta.members })),
      students,
      goals,
    };
  }

  /* ---------------- 行动操作 ---------------- */

  async runScan(record: ActivityRecord): Promise<void> {
    try {
      const summary = await scanActivity(this.app, this.settings, record);
      new Notice(`扫描完成：${summary.total} 个文件，已转写 ${summary.transcribed}，已说明 ${summary.described}。`);
      this.refreshViews();
    } catch (error) {
      new Notice(`扫描失败：${error instanceof Error ? error.message : String(error)}`, 8000);
    }
  }

  async runOrganize(record: ActivityRecord): Promise<void> {
    const artifacts = await listArtifacts(this.app, record.folder);
    const media = artifacts.filter((a) => a.kind === "audio" || a.kind === "video" || a.kind === "image");
    if (!media.length) {
      new Notice("素材/ 里没有可整理的录音、视频或图片。");
      return;
    }

    const needsAsr = artifacts.filter(
      (artifact) => (artifact.kind === "audio" || artifact.kind === "video") && !artifact.hasTranscript,
    );
    const needsVision = artifacts.filter(
      (artifact) => (artifact.kind === "image" || artifact.kind === "video") && !artifact.hasDescription,
    );

    if (needsAsr.length && this.settings.asrEnabled && !this.settings.asrApiKey.trim()) {
      new Notice(
        `检测到 ${needsAsr.length} 个待转写录音/视频，但还没有配置「语音转写」的 API Key。\n\n设置 → 素养评估 → 语音转写里单独填；DeepSeek 的文本 Key 不能转写音频。\n\n也可以把「得到大脑」等现成转写文字放进 素材/ 或 观察/，直接生成报告。`,
        15_000,
      );
      return;
    }
    if (needsAsr.length && !this.settings.asrEnabled) {
      new Notice(`语音转写已关闭，${needsAsr.length} 个录音/视频会跳过；需要转写就到设置里开启并填 Key。`, 9_000);
    }
    if (needsVision.length) {
      if (!this.settings.visionEnabled) {
        new Notice(`图像理解已关闭，${needsVision.length} 张图片/视频画面会跳过。`, 8_000);
      } else {
        const visionModel = (this.settings.visionModel || this.settings.aiModel).trim();
        if (/deepseek-chat|deepseek-reasoner/i.test(visionModel)) {
          new Notice(
            `注意：当前视觉模型是 ${visionModel}，DeepSeek 文本模型通常不支持图片输入。图片/视频画面如果失败，请换成视觉模型，或关闭图像理解。`,
            12_000,
          );
        }
      }
    }

    const ok = await this.confirm(
      `本次将把 ${media.length} 个录音/视频/图片发送到设置里的 AI 服务（${this.settings.aiBaseUrl}）。素材只从你的电脑直接发往该服务，不经过白日梦服务器。`,
    );
    if (!ok) return;

    await this.withProgress("AI 整理素材", async (progress) => {
      const summary = await organizeActivity(this.app, this.settings, record, progress);
      new Notice(
        `整理完成：转写 ${summary.transcribed}，图像/视频说明 ${summary.described}，跳过 ${summary.skipped}，失败 ${summary.failed}。`,
        8000,
      );
    });
    this.refreshViews();
  }

  async runReport(record: ActivityRecord): Promise<void> {
    const ok = await this.confirm(
      "本次将把活动笔记、导师观察、转写与图像说明发送到设置里的 AI 服务，用来生成证据清单和成长报告。报告会保存在本地，由你确认后使用。",
    );
    if (!ok) return;

    let reportPath = "";
    await this.withProgress("生成活动成长报告", async (progress) => {
      const result = await assessActivity(this.app, this.settings, record, progress);
      reportPath = result.reportPath;
    });
    await syncAllRelations(this.app, this.settings);
    this.refreshViews();
    if (reportPath && this.settings.autoOpenReport) {
      await openFile(this.app, reportPath);
    }
  }

  async runStageReport(): Promise<void> {
    const students = await listStudents(this.app, this.settings);
    if (!students.length) {
      new Notice("还没有学员。先在「新建行动」里填写参与学员，或运行「创建数据目录结构」。");
      return;
    }
    new StageReportModal(this.app, students, (student, period) => {
      void (async () => {
        const ok = await this.confirm(
          `将为「${student}」汇总跨活动证据并发送到 AI 服务，生成阶段性成长报告。`,
        );
        if (!ok) return;
        let reportPath = "";
        await this.withProgress("生成阶段性成长报告", async (progress) => {
          const result = await generateStageReport(this.app, this.settings, student, period, progress);
          reportPath = result.reportPath;
        });
        await syncAllRelations(this.app, this.settings);
        this.refreshViews();
        if (reportPath && this.settings.autoOpenReport) {
          await openFile(this.app, reportPath);
        }
      })();
    }).open();
  }

  async runSeriesReport(presetSeries?: string): Promise<void> {
    const activities = await this.getActivities();
    const allGroups = groupActionsBySeries(activities.map((activity) => activity.meta));
    const groups = presetSeries
      ? allGroups.filter((group) => group.name === presetSeries)
      : allGroups;
    if (!groups.length) {
      new Notice("还没有可生成报告的项目。先给行动选择归属项目，或新建项目。");
      return;
    }
    const students = await listStudents(this.app, this.settings);
    if (!students.length) {
      new Notice("还没有学生。先在行动笔记里填写 participants，或新建同学。");
      return;
    }
    new SeriesReportModal(
      this.app,
      groups.map((group) => ({ id: group.id, name: group.name, count: group.actions.length })),
      students,
      (series, student) => {
        void (async () => {
          const ok = await this.confirm(
            `将把「${series}」中 ${student} 的多次行动证据发送到 AI 服务，生成项目报告。`,
          );
          if (!ok) return;
          let reportPath = "";
          await this.withProgress("生成项目报告", async (progress) => {
            const result = await generateSeriesReport(this.app, this.settings, series, student, progress);
            reportPath = result.reportPath;
          });
          await syncAllRelations(this.app, this.settings);
          this.refreshViews();
          if (reportPath && this.settings.autoOpenReport) {
            await openFile(this.app, reportPath);
          }
        })();
      },
      presetSeries,
    ).open();
  }

  async runProjectOverview(projectName: string): Promise<void> {
    const ok = await this.confirm(
      `将把「${projectName}」全部同学、全部行动的证据汇总成项目总报告，并生成内部版与对外版。`,
    );
    if (!ok) return;
    let reportPath = "";
    await this.withProgress("生成项目总报告", async (progress) => {
      const result = await generateProjectOverviewReport(this.app, this.settings, projectName, "", progress);
      reportPath = result.reportPath;
    });
    await syncAllRelations(this.app, this.settings);
    this.refreshViews();
    if (reportPath && this.settings.autoOpenReport) await openFile(this.app, reportPath);
  }

  async runTermOverview(): Promise<void> {
    new OverviewReportModal(this.app, (period) => {
      void (async () => {
        const ok = await this.confirm(
          `将把「${period}」全部项目、全部同学的行动证据汇总成总报告，并生成内部版与对外版。`,
        );
        if (!ok) return;
        let reportPath = "";
        await this.withProgress("生成学期/学年总报告", async (progress) => {
          const result = await generateTermOverviewReport(this.app, this.settings, period, progress);
          reportPath = result.reportPath;
        });
        await syncAllRelations(this.app, this.settings);
        this.refreshViews();
        if (reportPath && this.settings.autoOpenReport) await openFile(this.app, reportPath);
      })();
    }).open();
  }

  async runGetnoteSync(): Promise<void> {
    if (this.getnoteSyncRunning) {
      new Notice("得到同步正在进行中，请等这次完成。");
      return;
    }
    if (!this.settings.getnoteApiKey.trim() || !this.settings.getnoteClientId.trim()) {
      new Notice(
        "还没有配置得到大脑 API Key / Client ID。\n设置 → 素养评估 → 得到大脑；OpenAPI 需要得到大脑会员。",
        10_000,
      );
      return;
    }
    this.getnoteSyncRunning = true;
    try {
      await this.withProgress("同步得到录音", async (progress) => {
        const summary = await importGetnoteRecordings(this.app, this.settings, progress);
        const errors = summary.errors.slice(0, 3);
        const detail = errors.length ? `\n\n${errors.join("\n")}` : "";
        new Notice(
          `得到同步完成：读取 ${summary.fetched}，暂存 ${summary.staged}，匹配 ${summary.matched}，待匹配 ${summary.pending}，失败 ${summary.failed}。${detail}`,
          30_000,
        );
        if (summary.pending) {
          new Notice("未匹配的笔记留在 05_导入/得到/，可补行动信息后再同步。", 10_000);
        }
        if (summary.failed) {
          new Notice("失败明细已写入 05_导入/得到/上次同步错误.md。", 10_000);
        }
      });
      await syncAllRelations(this.app, this.settings);
      this.refreshViews();
    } finally {
      this.getnoteSyncRunning = false;
    }
  }

  async testGetnoteConnection(): Promise<number> {
    return testGetnote(this.settings);
  }

  async openGetnoteCatalog(): Promise<void> {
    const path = `${this.settings.dataRoot}/${FOLDERS.imports}/得到/00_得到导入总目录.md`;
    if (!(await pathExists(this.app, path))) {
      new Notice("还没有得到导入总目录；先点一次「同步得到」。");
      return;
    }
    await openFile(this.app, path);
  }

  private isReportPath(path: string): boolean {
    return /\/报告\//.test(path) || /行动成长报告|项目成长报告|系列成长报告|阶段成长报告|总报告/.test(path);
  }

  async exportActiveReportPdf(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || !this.isReportPath(file.path)) {
      new Notice("先打开一份活动/项目/阶段成长报告，再导出 PDF。");
      return;
    }
    await this.exportPdf(file.path);
  }

  async exportPdf(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) {
      new Notice("找不到这份报告文件。");
      return;
    }
    await openFile(this.app, file.path);
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("请先以 Markdown 视图打开报告，再导出 PDF。");
      return;
    }
    const commands = (this.app as unknown as { commands: { executeCommandById(id: string): boolean } }).commands;
    const ok = commands.executeCommandById("workspace:export-pdf");
    if (!ok) {
      new Notice("Obsidian 没有找到「导出为 PDF」命令；请确认版本支持。", 8000);
      return;
    }
    const reportFolder = normalizePath(path).split("/").slice(0, -1).join("/");
    await writeText(this.app, `${reportFolder}/.pdf-exported`, `${new Date().toISOString()}\n`);
    this.refreshViews();
  }

  async archiveActivity(record: ActivityRecord): Promise<void> {
    const ok = await this.confirm(
      `归档「${record.meta.title}」后，它会从右侧列表消失；行动文件和报告仍保留在目录里。`,
    );
    if (!ok) return;
    await updateActivityStatus(this.app, record.folder, "已归档");
    new Notice(`已归档：${record.meta.title}`);
    this.refreshViews();
  }

  async createDataStructure(silent = false): Promise<void> {
    try {
      await ensureDataStructure(this.app, this.settings);
      await syncAllRelations(this.app, this.settings);
      if (!silent) new Notice("目录结构已准备好，双链关系已同步。");
    } catch (error) {
      new Notice(`初始化目录失败：${error instanceof Error ? error.message : String(error)}`, 8000);
    }
  }

  async syncRelations(): Promise<void> {
    try {
      await syncAllRelations(this.app, this.settings);
      new Notice("双链关系已同步。");
      this.refreshViews();
    } catch (error) {
      new Notice(`同步双链失败：${error instanceof Error ? error.message : String(error)}`, 8000);
    }
  }

  async normalizeFilenames(): Promise<void> {
    try {
      const changed = await normalizeEntityFilenames(this.app, this.settings);
      await syncAllRelations(this.app, this.settings);
      new Notice(changed ? `已规范化 ${changed} 个文件名。` : "文件名已符合规范。");
      this.refreshViews();
    } catch (error) {
      new Notice(`规范化文件名失败：${error instanceof Error ? error.message : String(error)}`, 8000);
    }
  }

  async openFramework(): Promise<void> {
    await this.createDataStructure(true);
    const path = resolveFrameworkPath(this.settings);
    if (!(await pathExists(this.app, path))) {
      new Notice("框架文件还不存在，先点「创建目录结构」。");
      return;
    }
    await openFile(this.app, path);
  }

  async testAiConnection(): Promise<void> {
    await testConnection(this.settings);
  }

  private async testAiConnectionNotice(): Promise<void> {
    const notice = new Notice("正在测试 AI 连接…", 0);
    try {
      await this.testAiConnection();
      notice.hide();
      new Notice("AI 连接成功。");
    } catch (error) {
      notice.hide();
      new Notice(error instanceof Error ? error.message : String(error), 8000);
    }
  }

  /* ---------------- 工具 ---------------- */

  private async withProgress(title: string, task: (progress: ProgressModal) => Promise<void>): Promise<void> {
    const modal = new ProgressModal(this.app, title);
    modal.open();
    try {
      await task(modal);
      modal.setStatus("完成。");
      window.setTimeout(() => modal.close(), 1600);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      modal.setStatus(`失败：${message}`);
      new Notice(message, 10_000);
    }
  }

  private confirm(message: string): Promise<boolean> {
    if (!this.settings.confirmBeforeUpload) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      new ConfirmUploadModal(this.app, message, resolve).open();
    });
  }

  private async getActiveActivity(): Promise<ActivityRecord | null> {
    const file = this.app.workspace.getActiveFile();
    if (!file) return null;
    const folder = this.activityFolderOfPath(file.path);
    if (!folder) return null;
    return readActivity(this.app, folder);
  }

  private activityFolderOfPath(path: string): string | null {
    const normalized = normalizePath(path);
    const root = normalizePath(this.settings.dataRoot);
    // 新库使用 01_项目；旧库的 01_系列 仍可定位。
    for (const folderName of [FOLDERS.series, LEGACY_SERIES_FOLDER]) {
      const seriesMarker = `${root}/${folderName}/`;
      const seriesIndex = normalized.indexOf(seriesMarker);
      if (seriesIndex < 0) continue;
      const rest = normalized.slice(seriesIndex + seriesMarker.length);
      const parts = rest.split("/");
      const actionIndex = parts.indexOf(ACTIONS_SUBFOLDER);
      if (actionIndex >= 1 && parts.length > actionIndex + 1) {
        return `${seriesMarker}${parts.slice(0, actionIndex + 2).join("/")}`;
      }
    }

    // 兼容旧版 01_行动
    const legacyMarker = `${root}/01_行动/`;
    const legacyIndex = normalized.indexOf(legacyMarker);
    if (legacyIndex < 0) return null;
    const rest = normalized.slice(legacyIndex + legacyMarker.length);
    const folderName = rest.split("/")[0];
    if (!folderName) return null;
    return `${legacyMarker}${folderName}`;
  }

  private async runOnActive(action: (record: ActivityRecord) => Promise<void>): Promise<void> {
    const record = await this.getActiveActivity();
    if (!record) {
      new Notice("先打开一个行动笔记（01_项目/…/行动/…/行动名称.md；旧库 01_系列 也兼容），或在右侧栏的操作按钮里选择行动。");
      return;
    }
    await action(record);
  }

  private async runFolder(folder: string, action: (record: ActivityRecord) => Promise<void>): Promise<void> {
    const record = await readActivity(this.app, folder);
    if (!record) {
      new Notice("读不到行动笔记。");
      return;
    }
    await action(record);
  }

}
