/**
 * 本地导师审核：只审核 level 调整和总体性评估；不逐条审核证据。
 */
import { App, Modal, Setting } from "obsidian";
import type {
  LevelDecision,
  LevelProposal,
  ReviewRecord,
} from "./types";
import { openFile } from "./vault";

type ProposalChoice = "approved" | "kept" | "modified" | "deferred";

interface ProposalState {
  proposal: LevelProposal;
  choice: ProposalChoice;
  finalLevel: string;
}

export interface PendingReviewItem {
  title: string;
  subtitle: string;
  open: () => void;
}

export class PendingReviewsModal extends Modal {
  constructor(
    app: App,
    private readonly items: PendingReviewItem[],
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("待我审核");
    const { contentEl } = this;
    if (!this.items.length) {
      contentEl.createEl("p", { text: "没有待审核的报告。" });
      return;
    }
    for (const item of this.items) {
      const row = contentEl.createDiv({ cls: "la-review-row" });
      row.createEl("strong", { text: item.title });
      row.createDiv({ cls: "setting-item-description", text: item.subtitle });
      const button = row.createEl("button", { cls: "mod-cta", text: "打开审核" });
      button.onclick = () => {
        this.close();
        item.open();
      };
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class ReviewModal extends Modal {
  private states: ProposalState[];
  private notes = "";

  constructor(
    app: App,
    private readonly review: ReviewRecord,
    private readonly reportTitle: string,
    private readonly onApprove: (decisions: LevelDecision[], notes: string) => Promise<void>,
    private readonly onRequestChanges: (notes: string) => Promise<void>,
  ) {
    super(app);
    this.states = (this.review.level_proposals ?? []).map((proposal) => ({
      proposal,
      choice:
        proposal.proposed_level &&
        proposal.proposed_level !== "未判断" &&
        proposal.proposed_level !== proposal.current_level
          ? "approved"
          : "kept",
      finalLevel: proposal.proposed_level || proposal.current_level,
    }));
  }

  onOpen(): void {
    const { contentEl } = this;
    this.titleEl.setText("审核报告");
    contentEl.createEl("h2", { text: this.reportTitle });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: "你只需要审核 level 调整和总体性评估。证据供查验，不需要逐条确认。",
    });
    const open = contentEl.createEl("button", { text: "打开报告正文" });
    open.onclick = () => void openFile(this.app, this.review.report_path);

    const quality = this.review.quality_summary;
    if (quality) {
      contentEl.createEl("h3", { text: "评估质量摘要" });
      const summary = contentEl.createDiv();
      summary.createDiv({ text: `来源：${quality.source_count} ｜ 目标：${quality.goal_count} ｜ 低置信度：${quality.low_confidence_count} ｜ 矛盾：${quality.contradiction_count}` });
      if (quality.gaps.length) summary.createDiv({ text: `证据缺口：${quality.gaps.join("；")}` });
    }

    if (this.review.teaching_feedback) {
      contentEl.createEl("h3", { text: "教学反馈" });
      const f = this.review.teaching_feedback;
      for (const [label, items] of [
        ["课堂/行动带领", f.leading],
        ["证据与信息收集", f.evidence_collection],
        ["下一次观察", f.next_observation],
      ] as Array<[string, string[]]>) {
        if (!items.length) continue;
        contentEl.createEl("strong", { text: label });
        const list = contentEl.createEl("ul");
        for (const item of items) list.createEl("li", { text: item });
      }
    }

    contentEl.createEl("h3", { text: "Level 调整审核" });
    if (!this.states.length) {
      contentEl.createEl("p", { cls: "setting-item-description", text: "本次没有 AI 提出的 level 调整；仍需审核总体性评估。" });
    }
    for (const state of this.states) {
      const p = state.proposal;
      const card = contentEl.createDiv({ cls: "la-review-card" });
      card.createEl("strong", { text: `${p.student} · ${p.goal_title || p.goal}` });
      card.createDiv({
        cls: "setting-item-description",
        text: `当前 ${p.current_level} → 建议 ${p.proposed_level} ｜ 置信度 ${Math.round(p.confidence * 100)}% ｜ 量表：${p.met}`,
      });
      if (p.reason) card.createDiv({ text: `依据：${p.reason}` });
      if (p.context_note) card.createDiv({ cls: "setting-item-description", text: `情境：${p.context_note}` });
      if (p.evidence_refs.length) {
        card.createDiv({ cls: "setting-item-description", text: `关联证据：${p.evidence_refs.slice(0, 5).join("；")}` });
      }

      new Setting(card)
        .setName("审核决定")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("approved", "同意调整")
            .addOption("kept", "保持原 level")
            .addOption("modified", "改为其他 level")
            .addOption("deferred", "暂缓，补充证据")
            .setValue(state.choice)
            .onChange((value) => {
              state.choice = value as ProposalChoice;
              if (value !== "modified") state.finalLevel = value === "kept" ? p.current_level : p.proposed_level;
              this.renderFinalLevel(card, state);
            }),
        );
      this.renderFinalLevel(card, state);
    }

    contentEl.createEl("h3", { text: "总体性评估" });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: "通过表示这份报告的总体结论、限制和下一步建议可以作为正式报告使用。",
    });
    new Setting(contentEl)
      .setName("审核备注（可选）")
      .addTextArea((area) => {
        area.setPlaceholder("例如：同意，下一次补一次独立观察。");
        area.inputEl.rows = 3;
        area.onChange((value) => {
          this.notes = value;
        });
      });

    const actions = contentEl.createDiv({ cls: "la-confirm-row" });
    const request = actions.createEl("button", { text: "退回修改" });
    request.onclick = () => {
      void (async () => {
        await this.onRequestChanges(this.notes || "需要补充或修改。");
        this.close();
      })();
    };
    const approve = actions.createEl("button", { cls: "mod-cta", text: "批准报告" });
    approve.onclick = () => {
      void (async () => {
        const decisions: LevelDecision[] = this.states.map((state) => {
          const p = state.proposal;
          const decision =
            state.choice === "approved"
              ? "approved"
              : state.choice === "kept"
                ? "kept"
                : state.choice === "modified"
                  ? "modified"
                  : "deferred";
          const finalLevel =
            decision === "kept"
              ? p.current_level
              : decision === "approved"
                ? p.proposed_level
                : state.finalLevel || p.current_level;
          return {
            student: p.student,
            framework_id: p.framework_id,
            goal: p.goal,
            current_level: p.current_level,
            proposed_level: p.proposed_level,
            final_level: finalLevel,
            decision,
            note: this.notes,
            decided_at: new Date().toISOString(),
          };
        });
        await this.onApprove(decisions, this.notes);
        this.close();
      })();
    };
  }

  private renderFinalLevel(card: HTMLElement, state: ProposalState): void {
    card.querySelector(".la-final-level")?.remove();
    if (state.choice !== "modified") return;
    const setting = new Setting(card)
      .setName("最终 level")
      .addText((text) => {
        text.setValue(state.finalLevel).onChange((value) => {
          state.finalLevel = value.trim();
        });
      });
    setting.settingEl.addClass("la-final-level");
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
