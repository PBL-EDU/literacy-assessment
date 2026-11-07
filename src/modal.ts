/**
 * 弹窗：新建行动、进度、隐私确认、阶段报告。
 */
import { App, Modal, Notice, Setting } from "obsidian";
import type {
  ActivityType,
  NewActivityInput,
  NewGroupInput,
  NewSeriesInput,
  SeriesType,
} from "./types";
import { parseGoals, parseParticipants, todayISO } from "./core";

export interface ActivityFormOptions {
  series: Array<{ name: string; count: number }>;
  groups: Array<{ name: string; members: string[] }>;
  students: string[];
  goals: string[];
}

export class NewActivityModal extends Modal {
  private input: NewActivityInput;
  private selectedStudents = new Set<string>();
  private selectedGroups = new Set<string>();
  private selectedGoals = new Set<string>();
  private newParticipants = "";
  private newGoals = "";
  private sequenceSelect: HTMLSelectElement | null = null;

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

    const groupBox = contentEl.createEl("div", { cls: "la-choice" });
    groupBox.createEl("div", { cls: "la-choice-title", text: "参与小组（可多选）" });
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
      });
      label.createEl("span", { text: `${group.name}（${group.members.length} 人）` });
    }

    const studentBox = contentEl.createEl("div", { cls: "la-choice" });
    studentBox.createEl("div", { cls: "la-choice-title", text: "参与学员（可多选；选小组会自动带上成员）" });
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
      });
      label.createEl("span", { text: student });
    }

    new Setting(contentEl)
      .setName("新增学员")
      .setDesc("逗号/顿号/换行分隔；会和勾选的学员合并")
      .addTextArea((area) => {
        area.setPlaceholder("张三、李四").onChange((value) => {
          this.newParticipants = value;
        });
        area.inputEl.rows = 2;
      });

    const goalBox = contentEl.createEl("div", { cls: "la-choice" });
    goalBox.createEl("div", { cls: "la-choice-title", text: "教学目标（可多选）" });
    for (const goal of this.options.goals) {
      const label = goalBox.createEl("label");
      const checkbox = label.createEl("input");
      checkbox.type = "checkbox";
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.selectedGoals.add(goal);
        else this.selectedGoals.delete(goal);
      });
      label.createEl("span", { text: goal });
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
    const goals = Array.from(new Set([...this.selectedGoals, ...parseGoals(this.newGoals)]));
    if (!goals.length) {
      new Notice("至少选/写一条教学目标。");
      return;
    }
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
      const option = document.createElement("option");
      option.value = String(index);
      option.text = `第 ${index} 次`;
      this.sequenceSelect.appendChild(option);
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
  };

  constructor(
    app: App,
    private readonly onSubmit: (input: NewSeriesInput) => void,
  ) {
    super(app);
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
            this.close();
            this.onSubmit({ ...this.input, title: this.input.title.trim() });
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

    const memberBox = contentEl.createEl("div", { cls: "la-choice" });
    memberBox.createEl("div", { cls: "la-choice-title", text: "固定成员" });
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
      label.createEl("span", { text: student });
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
    this.statusEl = contentEl.createEl("div", { cls: "la-progress-status", text: "准备中…" });
    this.logEl = contentEl.createEl("div", { cls: "la-progress-log" });
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
    const line = this.logEl.createEl("div", { text: message });
    line.style.marginBottom = "2px";
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

    const row = contentEl.createEl("label");
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.alignItems = "flex-start";
    row.style.margin = "12px 0";
    const checkbox = row.createEl("input");
    checkbox.type = "checkbox";
    checkbox.addEventListener("change", () => {
      this.confirmed = checkbox.checked;
    });
    row.createEl("span", {
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
