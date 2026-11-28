/**
 * 弹窗：新建行动、进度、隐私确认、阶段报告。
 */
import { App, FuzzySuggestModal, Modal, Notice, Setting, TFile } from "obsidian";
import type {
  ActivityType,
  FrameworkDefinition,
  FrameworkGoal,
  FrameworkRef,
  TargetRef,
  NewActivityInput,
  NewGroupInput,
  NewSeriesInput,
  SeriesType,
  AssessmentSettings,
  StudentTargetOverride,
} from "./types";
import { hashString, parseGoals, parseParticipants, todayISO } from "./core";
import { frameworkSourceLabel } from "./framework";
import { readProfile } from "./profile";
import type { ParsedPlan } from "./plan";

export interface ActivityFormOptions {
  series: Array<{ name: string; count: number }>;
  seriesGoals: Record<string, string[]>;
  seriesTargets: Record<string, TargetRef[]>;
  groups: Array<{ name: string; members: string[] }>;
  students: string[];
  goals: string[];
  frameworks: FrameworkDefinition[];
  settings: AssessmentSettings;
  defaultFrameworkRefs: FrameworkRef[];
  defaultTargets?: TargetRef[];
}

interface TargetTreeNode {
  name: string;
  children: Map<string, TargetTreeNode>;
  goals: FrameworkGoal[];
}

function targetKey(framework: FrameworkDefinition, goalId: string): string {
  return `${framework.source ?? "tenant"}::${framework.id}::${goalId}`;
}

function targetRefFor(framework: FrameworkDefinition, goal: FrameworkGoal): TargetRef {
  const path = goal.path?.trim() || goal.title;
  return {
    kind: "framework",
    source: framework.source ?? "tenant",
    frameworkId: framework.id,
    frameworkName: framework.name,
    frameworkVersion: framework.version,
    goalId: goal.id,
    path,
    title: goal.title,
  };
}

function buildTargetTree(framework: FrameworkDefinition): TargetTreeNode {
  const root: TargetTreeNode = { name: framework.name, children: new Map(), goals: [] };
  for (const goal of framework.goals) {
    const segments = goal.pathSegments?.length
      ? goal.pathSegments
      : (goal.path || goal.title).split("/").map((segment) => segment.trim()).filter(Boolean);
    let node = root;
    for (const segment of segments) {
      if (!node.children.has(segment)) {
        node.children.set(segment, { name: segment, children: new Map(), goals: [] });
      }
      node = node.children.get(segment)!;
    }
    node.goals.push(goal);
  }
  return root;
}

function renderTargetTree(
  container: HTMLElement,
  frameworks: FrameworkDefinition[],
  selected: Map<string, TargetRef>,
): void {
  if (!frameworks.length) {
    container.createEl("p", {
      cls: "setting-item-description",
      text: "还没有可用框架；加入组织或导入标准框架后，才能选择具体发展目标。",
    });
    return;
  }
  for (const framework of frameworks) {
    if (framework.errors.length) {
      container.createEl("p", {
        cls: "setting-item-description",
        text: `框架 ${framework.name} 暂不可用：${framework.errors.join("；")}`,
      });
      continue;
    }
    const frameDetails = container.createEl("details", { cls: "la-target-framework" });
    frameDetails.open = frameworks.length === 1;
    frameDetails.createEl("summary", {
      text: `${frameworkSourceLabel(framework.source)} · ${framework.name} · v${framework.version}`,
    });
    const root = buildTargetTree(framework);
    const renderNode = (node: TargetTreeNode, parent: HTMLElement, level: number): void => {
      for (const goal of node.goals) {
        const key = targetKey(framework, goal.id);
        const existing = selected.get(key);
        const label = parent.createEl("label", { cls: "la-target-choice" });
        label.style.paddingLeft = `${Math.max(level - 1, 0) * 14 + 4}px`;
        const checkbox = label.createEl("input", { type: "checkbox" });
        checkbox.checked = Boolean(existing);
        const levelSelect = label.createEl("select", { cls: "la-target-level" });
        levelSelect.createEl("option", { text: "期望 level", value: "" });
        for (const frameworkLevel of framework.levels) {
          const option = levelSelect.createEl("option", {
            text: frameworkLevel.label,
            value: frameworkLevel.key,
          });
          option.selected = existing?.expectedLevel === frameworkLevel.key;
        }
        levelSelect.disabled = !checkbox.checked;
        levelSelect.onchange = () => {
          const target = selected.get(key);
          if (target) target.expectedLevel = levelSelect.value || undefined;
        };
        checkbox.onchange = () => {
          if (checkbox.checked) {
            const target = targetRefFor(framework, goal);
            target.expectedLevel = levelSelect.value || undefined;
            selected.set(key, target);
          } else {
            selected.delete(key);
          }
          levelSelect.disabled = !checkbox.checked;
        };
        label.createSpan({ text: `${goal.id} ${goal.title}` });
        label.createSpan({ cls: "la-target-path", text: goal.path || goal.title });
      }
      for (const child of node.children.values()) {
        if (level === 0) {
          // 一级素养：下拉菜单（可展开/收起）
          const details = parent.createEl("details", { cls: "la-target-branch" });
          details.open = false;
          details.createEl("summary", { text: child.name });
          renderNode(child, details, level + 1);
        } else {
          // 二级素养及以下：不再折叠；直接显示二级名称和目标复选框。
          if (child.children.size) {
            const subhead = parent.createDiv({ cls: "la-target-subhead" });
            subhead.style.paddingLeft = `${Math.max(level, 1) * 14 + 4}px`;
            subhead.setText(child.name);
          }
          renderNode(child, parent, level + 1);
        }
      }
    };
    renderNode(root, frameDetails, 0);
  }
}

function renderCustomTargets(container: HTMLElement, selected: Map<string, TargetRef>): void {
  const box = container.createDiv({ cls: "la-custom-targets" });
  const refresh = (): void => {
    box.empty();
    box.createDiv({ cls: "la-choice-title", text: "其他目标（不来自框架）" });
    const existing = [...selected.values()].filter((target) => target.kind === "custom");
    for (const target of existing) {
      const row = box.createDiv({ cls: "la-custom-target-row" });
      row.createSpan({ text: target.title });
      if (target.expectedLevelText) {
        row.createSpan({ cls: "la-target-path", text: `期望：${target.expectedLevelText}` });
      }
      const remove = row.createEl("button", { text: "移除", cls: "la-custom-remove" });
      remove.onclick = () => {
        selected.delete(`custom::${target.goalId}`);
        refresh();
      };
    }
    const title = box.createEl("input", {
      type: "text",
      placeholder: "其他目标，例如：完成一次社区访谈",
      cls: "la-custom-title",
    });
    const expected = box.createEl("input", {
      type: "text",
      placeholder: "期望（可选，文字）",
      cls: "la-custom-expected",
    });
    const add = box.createEl("button", { text: "添加其他目标", cls: "la-custom-add" });
    add.onclick = () => {
      const value = title.value.trim();
      if (!value) return;
      const id = `custom_${hashString(value).slice(0, 10)}`;
      const key = `custom::${id}`;
      if (selected.has(key)) return;
      selected.set(key, {
        kind: "custom",
        frameworkId: "",
        frameworkName: "",
        frameworkVersion: "",
        goalId: id,
        path: "",
        title: value,
        expectedLevelText: expected.value.trim() || undefined,
      });
      refresh();
    };
  };
  refresh();
}

function renderActionTargets(
  container: HTMLElement,
  baseTargets: TargetRef[],
  selected: Map<string, TargetRef>,
): void {
  const retainedCustom = [...selected.values()].filter((target) => target.kind === "custom");
  selected.clear();
  for (const target of baseTargets) {
    const key = target.kind === "custom"
      ? `custom::${target.goalId}`
      : `${target.source ?? "tenant"}::${target.frameworkId}::${target.goalId}`;
    selected.set(key, { ...target, inheritedFrom: "project" });
  }
  for (const target of retainedCustom) selected.set(`custom::${target.goalId}`, target);

  container.empty();
  const title = container.createDiv({ cls: "la-choice-title", text: "行动目标（继承项目）" });
  title.setAttr("data-la", "action-targets");
  if (!baseTargets.length) {
    container.createEl("p", {
      cls: "la-hint",
      text: "当前项目没有已设置的目标；可先给项目添加目标，或在下方录入其他目标。",
    });
  }
  for (const target of baseTargets) {
    const key = target.kind === "custom"
      ? `custom::${target.goalId}`
      : `${target.source ?? "tenant"}::${target.frameworkId}::${target.goalId}`;
    const label = container.createEl("label", { cls: "la-target-choice" });
    const checkbox = label.createEl("input", { type: "checkbox" });
    checkbox.checked = true;
    checkbox.onchange = () => {
      if (checkbox.checked) selected.set(key, { ...target, inheritedFrom: "project" });
      else selected.delete(key);
    };
    label.createSpan({
      text: target.kind === "custom"
        ? `其他：${target.title}`
        : `${target.goalId} ${target.title}`,
    });
    if (target.kind === "custom") {
      if (target.expectedLevelText) label.createSpan({ cls: "la-target-path", text: target.expectedLevelText });
    } else {
      label.createSpan({
        cls: "la-target-path",
        text: `期望 ${target.expectedLevel ?? "未设定"}（继承，只读）`,
      });
    }
  }
  renderCustomTargets(container, selected);
}

function refTargetKey(target: TargetRef): string {
  return target.kind === "custom"
    ? `custom::${target.goalId}`
    : `${target.source ?? "tenant"}::${target.frameworkId}::${target.goalId}`;
}

function frameworkForTarget(
  frameworks: FrameworkDefinition[],
  target: TargetRef,
): FrameworkDefinition | undefined {
  return frameworks.find(
    (framework) =>
      framework.id === target.frameworkId && (framework.source ?? "tenant") === (target.source ?? "tenant"),
  );
}

function levelIndex(framework: FrameworkDefinition, value: string | undefined): number {
  if (!value) return -1;
  return framework.levels.findIndex((level) => level.key === value || level.label === value);
}

export class NewActivityModal extends Modal {
  private input: NewActivityInput;
  private selectedStudents = new Set<string>();
  private selectedGroups = new Set<string>();
  private selectedGoals = new Set<string>();
  private selectedTargets = new Map<string, TargetRef>();
  private newParticipants = "";
  private newGoals = "";
  private sequenceSelect: HTMLSelectElement | null = null;
  private targetBox: HTMLElement | null = null;
  private gapBox: HTMLElement | null = null;
  private studentTargets: Record<string, StudentTargetOverride[]> = {};

  constructor(
    app: App,
    private readonly options: ActivityFormOptions,
    private readonly onSubmit: (input: NewActivityInput) => void,
  ) {
    super(app);
    this.input = {
      title: "",
      type: "课堂",
      date: todayISO(),
      startTime: "",
      endTime: "",
      mentor: "",
      participantsText: "",
      goalsText: "",
      series: "暂不归属",
      sequence: "1",
      groups: [],
      framework_refs: options.defaultFrameworkRefs,
      targets: options.defaultTargets ?? [],
    };
  }

  onOpen(): void {
    this.titleEl.setText("新建行动");
    const { contentEl } = this;

    new Setting(contentEl)
      .setName("行动名称")
      .setDesc("会创建在「01_项目/<项目>/行动/日期_名称」下；旧库 01_系列 兼容")
      .addText((text) =>
        text.setPlaceholder("例如：职业探索课 · 社区小店调研").onChange((value) => {
          this.input.title = value;
        }),
      );

    new Setting(contentEl)
      .setName("类型")
      .setDesc("「行动」是总称：项目、课程、课堂、活动、其他，都按每次行动记录")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("课堂", "课堂")
          .addOption("课程", "课程")
          .addOption("项目", "项目")
          .addOption("活动", "活动")
          .addOption("行动", "行动")
          .addOption("其他", "其他")
          .setValue(this.input.type)
          .onChange((value) => {
            this.input.type = value as ActivityType;
          }),
      );

    new Setting(contentEl).setName("日期").addText((text) => {
      text.inputEl.type = "date";
      text.setValue(this.input.date).onChange((value) => {
        this.input.date = value;
      });
    });

    new Setting(contentEl)
      .setName("开始时间")
      .setDesc("可选；用于得到录音按时间自动匹配。格式 HH:MM")
      .addText((text) => {
        text.inputEl.type = "time";
        text.setValue(this.input.startTime).onChange((value) => {
          this.input.startTime = value;
        });
      });

    new Setting(contentEl)
      .setName("结束时间")
      .setDesc("可选；不填则按开始时间 +1 小时估算")
      .addText((text) => {
        text.inputEl.type = "time";
        text.setValue(this.input.endTime).onChange((value) => {
          this.input.endTime = value;
        });
      });

    new Setting(contentEl).setName("导师").addText((text) =>
      text.setPlaceholder("你的名字").onChange((value) => {
        this.input.mentor = value;
      }),
    );

    new Setting(contentEl)
      .setName("归属项目")
      .setDesc("默认「暂不归属」；行动先放进 01_项目/暂不归属/行动/，之后可再补项目")
      .addDropdown((dropdown) => {
        dropdown.addOption("暂不归属", "暂不归属");
        for (const series of this.options.series) {
          dropdown.addOption(series.name, `${series.name}（已有 ${series.count} 次）`);
        }
        dropdown.setValue(this.input.series).onChange((value) => {
          this.input.series = value;
          this.updateSequence();
          this.renderActionTargets();
        });
      });

    new Setting(contentEl)
      .setName("项目第几次")
      .setDesc("按所选项目已有行动自动推荐，可改")
      .addDropdown((dropdown) => {
        this.sequenceSelect = dropdown.selectEl;
        this.renderSequenceOptions();
        dropdown.onChange((value) => {
          this.input.sequence = value;
        });
      });

    const groupBox = contentEl.createDiv({ cls: "la-choice" });
    groupBox.createDiv({ cls: "la-choice-title", text: "参与小组（可多选）" });
    if (!this.options.groups.length) {
      groupBox.createEl("p", { cls: "la-hint", text: "还没有小组；可先运行「新建小组」，或直接在下面勾选学员。" });
    }
    for (const group of this.options.groups) {
      const label = groupBox.createEl("label");
      const checkbox = label.createEl("input");
      checkbox.type = "checkbox";
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.selectedGroups.add(group.name);
        else this.selectedGroups.delete(group.name);
        void this.renderStudentGaps();
      });
      label.createSpan({ text: `${group.name}（${group.members.length} 人）` });
    }

    const studentBox = contentEl.createDiv({ cls: "la-choice" });
    studentBox.createDiv({ cls: "la-choice-title", text: "参与学员（可多选；选小组会自动带上成员）" });
    if (!this.options.students.length) {
      studentBox.createEl("p", { cls: "la-hint", text: "还没有学员；可在下面「新增学员」里输入。" });
    }
    for (const student of this.options.students) {
      const label = studentBox.createEl("label");
      const checkbox = label.createEl("input");
      checkbox.type = "checkbox";
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.selectedStudents.add(student);
        else this.selectedStudents.delete(student);
        void this.renderStudentGaps();
      });
      label.createSpan({ text: student });
    }

    new Setting(contentEl)
      .setName("新增学员")
      .setDesc("逗号/顿号/换行分隔；会和勾选的学员合并")
      .addTextArea((area) => {
        area.setPlaceholder("张三、李四").onChange((value) => {
          this.newParticipants = value;
          void this.renderStudentGaps();
        });
        area.inputEl.rows = 2;
      });

    const goalBox = contentEl.createDiv({ cls: "la-choice" });
    goalBox.createDiv({ cls: "la-choice-title", text: "教学目标（可多选）" });
    for (const goal of this.options.goals) {
      const label = goalBox.createEl("label");
      const checkbox = label.createEl("input");
      checkbox.type = "checkbox";
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.selectedGoals.add(goal);
        else this.selectedGoals.delete(goal);
      });
      label.createSpan({ text: goal });
    }
    if (!this.options.goals.length) {
      goalBox.createEl("p", { cls: "la-hint", text: "还没有可复用的目标；可在下面新增。" });
    }

    new Setting(contentEl)
      .setName("新增教学目标")
      .setDesc("一行一条；会和勾选的目标合并")
      .addTextArea((area) => {
        area.setPlaceholder("例如：能说出小店为谁提供了什么价值").onChange((value) => {
          this.newGoals = value;
        });
        area.inputEl.rows = 2;
      });

    const targetBox = contentEl.createDiv({ cls: "la-choice la-target-picker" });
    this.targetBox = targetBox;
    this.renderActionTargets();

    new Setting(contentEl)
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText("创建行动")
          .setCta()
          .onClick(() => this.submit()),
      );

    const hint = contentEl.createEl("p", { cls: "la-hint" });
    hint.setText(
      "创建后：素材放进 素材/，导师复盘放进 观察/，再运行「扫描素材」和「AI 整理素材」。\n得到录音可以点「同步得到」，按录音时间与内容自动匹配。",
    );
  }

  private renderActionTargets(): void {
    if (!this.targetBox) return;
    const base = this.input.series === "暂不归属" ? [] : this.options.seriesTargets[this.input.series] ?? [];
    renderActionTargets(this.targetBox, base, this.selectedTargets);
    void this.renderStudentGaps();
  }

  private async renderStudentGaps(): Promise<void> {
    if (!this.gapBox) return;
    const box = this.gapBox;
    box.empty();
    box.createDiv({ cls: "la-choice-title", text: "学生目标差距" });
    const groupMembers = this.options.groups
      .filter((group) => this.selectedGroups.has(group.name))
      .flatMap((group) => group.members);
    const participants = Array.from(
      new Set([
        ...this.selectedStudents,
        ...groupMembers,
        ...parseParticipants(this.newParticipants),
      ]),
    );
    if (!participants.length) {
      box.createEl("p", { cls: "la-hint", text: "选择参与学生后，会显示当前 level 与期望 level 的差距。" });
      return;
    }
    const frameworkTargets = [...this.selectedTargets.values()].filter(
      (target) => target.kind !== "custom" && Boolean(target.expectedLevel),
    );
    if (!frameworkTargets.length) {
      box.createEl("p", { cls: "la-hint", text: "还没有带期望 level 的框架目标。" });
      return;
    }
    for (const student of participants) {
      const profile = await readProfile(this.app, this.options.settings, student);
      for (const target of frameworkTargets) {
        const framework = frameworkForTarget(this.options.frameworks, target);
        if (!framework) continue;
        const expectedIndex = levelIndex(framework, target.expectedLevel);
        if (expectedIndex < 0) continue;
        const current = profile.levels.find(
          (item) =>
            item.frameworkId === target.frameworkId &&
            (item.goal === target.title || item.goal.includes(target.title) || target.title.includes(item.goal)),
        );
        if (!current) {
          const row = box.createDiv({ cls: "la-gap-row la-gap-missing" });
          row.createSpan({ text: `${student} · ${target.title}：暂无基线，待观察` });
          continue;
        }
        const currentIndex = levelIndex(framework, current.level);
        if (currentIndex < 0) continue;
        const difference = expectedIndex - currentIndex;
        if (difference < 2) continue;
        const row = box.createDiv({ cls: "la-gap-row" });
        row.createSpan({
          text: `${student} · ${target.title}：当前 ${current.level} → 期望 ${target.expectedLevel}，差 ${difference} 级`,
        });
        const select = row.createEl("select", { cls: "la-target-level" });
        select.createEl("option", { text: "保持基础", value: "" });
        for (const level of framework.levels) {
          const option = select.createEl("option", { text: level.label, value: level.key });
          const existing = (this.studentTargets[student] ?? []).find(
            (item) => item.targetKey === refTargetKey(target),
          );
          option.selected = existing?.expectedLevel === level.key;
        }
        select.onchange = () => {
          const key = refTargetKey(target);
          const rows = (this.studentTargets[student] ?? []).filter((item) => item.targetKey !== key);
          if (select.value) rows.push({ targetKey: key, expectedLevel: select.value });
          if (rows.length) this.studentTargets[student] = rows;
          else delete this.studentTargets[student];
        };
      }
    }
  }

  private submit(): void {
    if (!this.input.title.trim()) {
      new Notice("先填行动名称。");
      return;
    }
    const groupMembers = this.options.groups
      .filter((group) => this.selectedGroups.has(group.name))
      .flatMap((group) => group.members);
    const participants = Array.from(
      new Set([
        ...this.selectedStudents,
        ...groupMembers,
        ...parseParticipants(this.newParticipants),
      ]),
    );
    if (!participants.length) {
      new Notice("至少选一个参与学员或小组。");
      return;
    }
    const targetLabels = [...this.selectedTargets.values()].map((target) =>
      target.kind === "custom" ? target.title : `${target.path}（${target.goalId}）`,
    );
    const inheritedGoals = this.input.series === "暂不归属" ? [] : this.options.seriesGoals[this.input.series] ?? [];
    const goals = Array.from(new Set([...this.selectedGoals, ...parseGoals(this.newGoals), ...inheritedGoals, ...targetLabels]));
    if (!goals.length) {
      new Notice("至少选/写一条教学目标，或选择一个已有项目以继承项目目标。");
      return;
    }
    this.input.targets = [...this.selectedTargets.values()];
    this.input.student_targets = this.studentTargets;
    this.input.participantsText = participants.join("、");
    this.input.goalsText = goals.join("\n");
    this.input.groups = [...this.selectedGroups];
    this.input.title = this.input.title.trim();
    this.close();
    this.onSubmit(this.input);
  }

  private renderSequenceOptions(): void {
    if (!this.sequenceSelect) return;
    const count = this.options.series.find((item) => item.name === this.input.series)?.count ?? 0;
    const max = Math.max(5, count + 2);
    this.sequenceSelect.empty();
    for (let index = 1; index <= max; index++) {
      const option = this.sequenceSelect.createEl("option", { text: `第 ${index} 次` });
      option.value = String(index);
    }
    const next = String(count + 1);
    this.sequenceSelect.value = next;
    this.input.sequence = next;
  }

  private updateSequence(): void {
    this.renderSequenceOptions();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class NewSeriesModal extends Modal {
  private input: NewSeriesInput = {
    title: "",
    type: "项目",
    mentor: "",
    description: "",
    goalsText: "",
    framework_refs: [],
    targets: [],
  };
  private primaryFrameworkId = "";
  private supplementary = new Set<string>();
  private selectedTargets = new Map<string, TargetRef>();

  constructor(
    app: App,
    private readonly frameworks: FrameworkDefinition[],
    private readonly onSubmit: (input: NewSeriesInput) => void,
  ) {
    super(app);
    const firstValid = frameworks.find((framework) => !framework.errors.length);
    this.primaryFrameworkId = firstValid?.id ?? frameworks[0]?.id ?? "";
  }

  onOpen(): void {
    this.titleEl.setText("新建项目");
    const { contentEl } = this;

    new Setting(contentEl)
      .setName("项目名称")
      .setDesc("一个项目/课程/活动群的共同名称；行动会放在它的 行动/ 子文件夹")
      .addText((text) =>
        text.setPlaceholder("例如：2026 秋职业探索课 / 社区小店调研项目").onChange((value) => {
          this.input.title = value;
        }),
      );

    new Setting(contentEl).setName("类型").addDropdown((dropdown) =>
      dropdown
        .addOption("项目", "项目")
        .addOption("课程", "课程")
        .addOption("活动群", "活动群")
        .addOption("其他", "其他")
        .setValue(this.input.type)
        .onChange((value) => {
          this.input.type = value as SeriesType;
        }),
    );

    new Setting(contentEl).setName("导师").addText((text) =>
      text.setPlaceholder("负责人").onChange((value) => {
        this.input.mentor = value;
      }),
    );

    new Setting(contentEl).setName("素养框架").setHeading();
    if (!this.frameworks.length) {
      contentEl.createEl("p", {
        cls: "setting-item-description",
        text: "还没有找到素养框架。请先在 00_框架/ 放一份框架文件，或到设置页刷新框架库。",
      });
    } else {
      new Setting(contentEl)
        .setName("主框架")
        .setDesc("报告主体、学生 level 默认展示使用这个框架")
        .addDropdown((dropdown) => {
          for (const framework of this.frameworks) {
            const suffix = framework.errors.length ? "（量表有问题）" : "";
            dropdown.addOption(framework.id, `${framework.name} v${framework.version}${suffix}`);
          }
          dropdown.setValue(this.primaryFrameworkId).onChange((value) => {
            this.primaryFrameworkId = value;
          });
        });

      for (const framework of this.frameworks) {
        if (framework.id === this.primaryFrameworkId) continue;
        new Setting(contentEl)
          .setName(`补充框架：${framework.name}`)
          .setDesc(framework.errors.length ? `量表有问题：${framework.errors.join("；")}` : `v${framework.version} · 只作为补充观察`)
          .addToggle((toggle) =>
            toggle.setValue(false).onChange((value) => {
              if (value) this.supplementary.add(framework.id);
              else this.supplementary.delete(framework.id);
            }),
          );
      }
    }

    const targetBox = contentEl.createDiv({ cls: "la-choice la-target-picker" });
    targetBox.createDiv({ cls: "la-choice-title", text: "项目发展目标（多框架、多级目录）" });
    targetBox.createEl("p", {
      cls: "la-hint",
      text: "项目目标可来自多份框架；行动默认继承，也可以在行动里缩小。",
    });
    renderTargetTree(targetBox, this.frameworks, this.selectedTargets);
    renderCustomTargets(targetBox, this.selectedTargets);

    new Setting(contentEl)
      .setName("简介")
      .addTextArea((area) => {
        area.setPlaceholder("这个项目要做什么、为什么做、持续多久").onChange((value) => {
          this.input.description = value;
        });
        area.inputEl.rows = 3;
      });

    new Setting(contentEl)
      .setName("项目教学目标")
      .setDesc("一行一条；新建行动时可以直接勾选")
      .addTextArea((area) => {
        area.setPlaceholder("1. 能说出小店为谁提供了什么价值\n2. 能在小组里承担角色并完成分工").onChange((value) => {
          this.input.goalsText = value;
        });
        area.inputEl.rows = 4;
      });

    new Setting(contentEl)
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText("创建项目")
          .setCta()
          .onClick(() => {
            if (!this.input.title.trim()) {
              new Notice("先填项目名称。");
              return;
            }
            if (!this.selectedTargets.size) {
              new Notice("至少选择一个素养发展目标。");
              return;
            }
            const missingLevel = [...this.selectedTargets.values()].find(
              (target) => target.kind !== "custom" && !target.expectedLevel,
            );
            if (missingLevel) {
              new Notice(`请为 ${missingLevel.goalId} ${missingLevel.title} 选择期望 level。`);
              return;
            }
            this.close();
            const refs: FrameworkRef[] = [];
            if (this.primaryFrameworkId) {
              const primary = this.frameworks.find((framework) => framework.id === this.primaryFrameworkId);
              refs.push({ id: this.primaryFrameworkId, role: "primary", source: primary?.source });
            }
            for (const id of this.supplementary) {
              if (id !== this.primaryFrameworkId) {
                const framework = this.frameworks.find((item) => item.id === id);
                refs.push({ id, role: "supplementary", source: framework?.source });
              }
            }
            for (const target of this.selectedTargets.values()) {
              if (!refs.some((ref) => ref.id === target.frameworkId)) {
                if (target.frameworkId) {
                  refs.push({ id: target.frameworkId, role: "supplementary", source: target.source });
                }
              }
            }
            const targetLabels = [...this.selectedTargets.values()].map((target) =>
      target.kind === "custom" ? target.title : `${target.path}（${target.goalId}）`,
    );
            const goalsText = [this.input.goalsText, ...targetLabels].filter(Boolean).join("\n");
            this.onSubmit({ ...this.input, title: this.input.title.trim(), framework_refs: refs, targets: [...this.selectedTargets.values()], goalsText });
          }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class NewGroupModal extends Modal {
  private name = "";
  private mentor = "";
  private series = "";
  private description = "";
  private newMembers = "";
  private selectedMembers = new Set<string>();

  constructor(
    app: App,
    private readonly seriesOptions: string[],
    private readonly students: string[],
    private readonly onSubmit: (input: NewGroupInput) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("新建小组");
    const { contentEl } = this;
    this.series = this.seriesOptions[0] ?? "";

    new Setting(contentEl)
      .setName("小组名称")
      .addText((text) =>
        text.setPlaceholder("例如：小店探索 A 组").onChange((value) => {
          this.name = value;
        }),
      );

    new Setting(contentEl).setName("导师").addText((text) =>
      text.setPlaceholder("负责导师").onChange((value) => {
        this.mentor = value;
      }),
    );

    new Setting(contentEl)
      .setName("固定参与项目")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "（不指定）");
        for (const series of this.seriesOptions) dropdown.addOption(series, series);
        dropdown.setValue(this.series).onChange((value) => {
          this.series = value;
        });
      });

    const memberBox = contentEl.createDiv({ cls: "la-choice" });
    memberBox.createDiv({ cls: "la-choice-title", text: "固定成员" });
    if (!this.students.length) {
      memberBox.createEl("p", { cls: "la-hint", text: "还没有学员；可以先在下面新增。" });
    }
    for (const student of this.students) {
      const label = memberBox.createEl("label");
      const checkbox = label.createEl("input");
      checkbox.type = "checkbox";
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.selectedMembers.add(student);
        else this.selectedMembers.delete(student);
      });
      label.createSpan({ text: student });
    }

    new Setting(contentEl)
      .setName("新增成员")
      .setDesc("逗号/顿号/换行分隔；会同时建学员档案")
      .addTextArea((area) => {
        area.setPlaceholder("张三、李四").onChange((value) => {
          this.newMembers = value;
        });
        area.inputEl.rows = 2;
      });

    new Setting(contentEl)
      .setName("说明")
      .addTextArea((area) => {
        area.setPlaceholder("这个小组固定参与哪些项目/行动").onChange((value) => {
          this.description = value;
        });
        area.inputEl.rows = 2;
      });

    new Setting(contentEl)
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText("创建小组")
          .setCta()
          .onClick(() => {
            if (!this.name.trim()) {
              new Notice("先填小组名称。");
              return;
            }
            const members = [...this.selectedMembers, ...parseParticipants(this.newMembers)];
            if (!members.length) {
              new Notice("至少选一个成员。");
              return;
            }
            this.close();
            this.onSubmit({
              name: this.name.trim(),
              mentor: this.mentor.trim(),
              membersText: members.join("、"),
              series: this.series,
              description: this.description,
            });
          }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class NewStudentModal extends Modal {
  private name = "";

  constructor(
    app: App,
    private readonly onSubmit: (name: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("新建同学");
    const { contentEl } = this;
    new Setting(contentEl)
      .setName("同学姓名")
      .setDesc("会在 03_学员/ 下创建同学卡片；之后可补个性化目标")
      .addText((text) =>
        text.setPlaceholder("例如：张三").onChange((value) => {
          this.name = value;
        }),
      );

    new Setting(contentEl)
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText("创建同学")
          .setCta()
          .onClick(() => {
            if (!this.name.trim()) {
              new Notice("先填同学姓名。");
              return;
            }
            this.close();
            this.onSubmit(this.name.trim());
          }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class ProgressModal extends Modal {
  private statusEl: HTMLElement | null = null;
  private logEl: HTMLElement | null = null;
  private closed = false;

  constructor(
    app: App,
    private readonly title: string,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("la-progress");
    this.titleEl.setText(this.title);
    const { contentEl } = this;
    this.statusEl = contentEl.createDiv({ cls: "la-progress-status", text: "准备中…" });
    this.logEl = contentEl.createDiv({ cls: "la-progress-log" });
    new Setting(contentEl).addButton((button) =>
      button.setButtonText("中止").onClick(() => {
        this.closed = true;
        this.setStatus("已请求中止；当前文件处理完后会停下。");
      }),
    );
  }

  status(message: string): void {
    this.setStatus(message);
  }

  setStatus(message: string): void {
    if (this.statusEl) this.statusEl.setText(message);
  }

  log(message: string): void {
    if (!this.logEl) return;
    this.logEl.createDiv({ cls: "la-progress-line", text: message });
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  cancelled(): boolean {
    return this.closed;
  }

  onClose(): void {
    this.closed = true;
    this.contentEl.empty();
  }
}

export class ConfirmUploadModal extends Modal {
  private settled = false;
  private confirmed = false;

  constructor(
    app: App,
    private readonly message: string,
    private readonly onResult: (ok: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("发送前确认");
    const { contentEl } = this;
    contentEl.createEl("p", { text: this.message });

    const row = contentEl.createEl("label", { cls: "la-confirm-row" });
    const checkbox = row.createEl("input");
    checkbox.type = "checkbox";
    checkbox.addEventListener("change", () => {
      this.confirmed = checkbox.checked;
    });
    row.createSpan({
      text: "我确认已取得必要的监护人/机构同意，并了解这些素材会发送到设置里配置的 AI 服务；报告由我确认后再使用。",
    });

    new Setting(contentEl)
      .addButton((button) => button.setButtonText("取消").onClick(() => this.finish(false)))
      .addButton((button) =>
        button
          .setButtonText("继续")
          .setCta()
          .onClick(() => {
            if (!this.confirmed) {
              new Notice("请先勾选确认。");
              return;
            }
            this.finish(true);
          }),
      );
  }

  private finish(ok: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.onResult(ok);
    this.close();
  }

  onClose(): void {
    if (!this.settled) {
      this.settled = true;
      this.onResult(false);
    }
    this.contentEl.empty();
  }
}

export interface SeriesOption {
  id: string;
  name: string;
  count: number;
}

export class SeriesReportModal extends Modal {
  private series = "";
  private student = "";

  constructor(
    app: App,
    private readonly seriesOptions: SeriesOption[],
    private readonly students: string[],
    private readonly onSubmit: (series: string, student: string) => void,
    private readonly presetSeries?: string,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("生成项目报告");
    const { contentEl } = this;
    this.series = this.presetSeries && this.seriesOptions.some((item) => item.name === this.presetSeries)
      ? this.presetSeries
      : this.seriesOptions[0]?.name ?? "";
    this.student = this.students[0] ?? "";

    new Setting(contentEl)
      .setName("项目")
      .setDesc("同一项目/课程下的一组行动；在行动笔记里填「归属项目」")
      .addDropdown((dropdown) => {
        for (const option of this.seriesOptions) {
          dropdown.addOption(option.name, `${option.name}（${option.count} 次）`);
        }
        dropdown.setValue(this.series).onChange((value) => {
          this.series = value;
        });
      });

    new Setting(contentEl)
      .setName("学员")
      .setDesc("只汇总该学员在这个项目里的行动")
      .addDropdown((dropdown) => {
        for (const name of this.students) dropdown.addOption(name, name);
        dropdown.setValue(this.student).onChange((value) => {
          this.student = value;
        });
      });

    new Setting(contentEl)
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText("生成")
          .setCta()
          .onClick(() => {
            if (!this.series || !this.student) {
              new Notice("先选择项目和学员。");
              return;
            }
            this.close();
            this.onSubmit(this.series, this.student);
          }),
      );

    contentEl.createEl("p", {
      cls: "la-hint",
      text: "项目报告会汇总该项目内每个行动的活动报告/证据，对照素养框架看跨行动变化。单次行动请用「生成报告」。",
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class OverviewReportModal extends Modal {
  private period = "";

  constructor(
    app: App,
    private readonly onSubmit: (period: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("学期 / 学年总报告");
    const { contentEl } = this;
    new Setting(contentEl)
      .setName("周期名称")
      .setDesc("例如：2026 秋、2026-2027 学年")
      .addText((text) =>
        text.setPlaceholder("2026 秋").onChange((value) => {
          this.period = value;
        }),
      );
    new Setting(contentEl)
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText("生成总报告")
          .setCta()
          .onClick(() => {
            if (!this.period.trim()) {
              new Notice("先填周期名称。");
              return;
            }
            this.close();
            this.onSubmit(this.period.trim());
          }),
      );
    contentEl.createEl("p", {
      cls: "la-hint",
      text: "会汇总所有项目的行动和所有同学；内部版含真实信息，对外版自动化名并模糊照片。",
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class StageReportModal extends Modal {
  private student = "";
  private period = "";

  constructor(
    app: App,
    private readonly students: string[],
    private readonly onSubmit: (student: string, period: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("生成阶段性成长报告");
    const { contentEl } = this;
    this.student = this.students[0] ?? "";

    new Setting(contentEl)
      .setName("学员")
      .setDesc("只汇总 participants 里包含该名字的活动")
      .addDropdown((dropdown) => {
        for (const name of this.students) dropdown.addOption(name, name);
        dropdown.setValue(this.student).onChange((value) => {
          this.student = value;
        });
      });

    new Setting(contentEl)
      .setName("阶段标签")
      .setDesc("留空则自动用第一次到最近一次活动的日期范围")
      .addText((text) => text.setPlaceholder("例如：2026 秋 / 第一阶段").onChange((value) => {
        this.period = value;
      }));

    new Setting(contentEl)
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText("生成")
          .setCta()
          .onClick(() => {
            if (!this.student) {
              new Notice("没有可选的学员。先在行动笔记里填写 participants。");
              return;
            }
            this.close();
            this.onSubmit(this.student, this.period);
          }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}


export class PlanFileSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly onChoose: (file: TFile) => void,
  ) {
    super(app);
    this.setPlaceholder("选择标准计划 Markdown");
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}

export class PlanImportPreviewModal extends Modal {
  constructor(
    app: App,
    private readonly plan: ParsedPlan,
    private readonly targets: TargetRef[],
    private readonly errors: string[],
    private readonly onConfirm: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("导入计划预览");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: "确认将创建的内容。导入后以 Obsidian 笔记为工作副本，源文件不会自动同步。",
    });
    contentEl.createEl("h3", { text: this.plan.kind === "project" ? "项目" : "行动" });
    contentEl.createEl("p", { text: `标题：${this.plan.title || "（未填写）"}` });
    if (this.plan.project) contentEl.createEl("p", { text: `所属项目：${this.plan.project}` });
    if (this.plan.mentor) contentEl.createEl("p", { text: `导师：${this.plan.mentor}` });
    if (this.plan.date) contentEl.createEl("p", { text: `日期：${this.plan.date}` });
    contentEl.createEl("h3", { text: `目标（${this.targets.length}）` });
    for (const target of this.targets) {
      const text = target.kind === "custom"
        ? `其他目标：${target.title}${target.expectedLevelText ? `（期望：${target.expectedLevelText}）` : ""}`
        : `${target.goalId} ${target.title}｜期望 ${target.expectedLevel ?? "未设定"}｜${target.source ?? "tenant"}`;
      contentEl.createEl("p", { cls: "la-hint", text });
    }
    if (this.errors.length) {
      contentEl.createEl("h3", { text: "校验问题" });
      for (const error of this.errors) contentEl.createEl("p", { cls: "la-error", text: error });
    }
    new Setting(contentEl)
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText("确认导入")
          .setCta()
          .setDisabled(this.errors.length > 0)
          .onClick(async () => {
            button.setDisabled(true);
            try {
              await this.onConfirm();
              this.close();
            } catch (error) {
              new Notice(error instanceof Error ? error.message : String(error), 9000);
              button.setDisabled(false);
            }
          }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
