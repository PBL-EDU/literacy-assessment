/**
 * 报告渲染层：纯函数，输入归一化后的评估结果，输出 Markdown。
 */
import type { ActivityAssessment, EvidenceItem, OverviewAssessment, StageAssessment } from "./types";

function yamlScalar(value: string): string {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function cell(value: string): string {
  return (value || "—").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function quoteBlock(value: string): string {
  const text = (value || "").trim();
  if (!text) return "> （没有原文引文）";
  return text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function evidenceBlock(e: EvidenceItem): string {
  const meta = [
    e.goal ? `**目标**：${e.goal}` : "",
    e.dimension ? `**维度**：${e.dimension}` : "",
    e.level ? `**水平**：${e.level}` : "",
  ]
    .filter(Boolean)
    .join(" ｜ ");
  const origin = e.origin === "推断" ? `推断（置信度 ${e.confidence.toFixed(2)}）` : "原文";
  const note = e.note ? `\n  - 说明：${e.note}` : "";
  const photo = e.photo ? `\n  - 照片：\n\n    ![[${e.photo}]]` : "";
  return [
    `- ${meta || "**证据**"}`,
    `  - 来源：${e.source || "未标注"} ｜ ${origin}${note}${photo}`,
    quoteBlock(e.quote)
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n"),
  ].join("\n");
}

export function renderEvidenceTable(items: EvidenceItem[]): string {
  if (!items.length) return "（没有可核验的证据。）";
  const rows = items.map(
    (e) =>
      `| ${cell(e.student)} | ${cell(e.goal)} | ${cell(e.dimension)} | ${cell(e.level)} | ${cell(e.source)} | ${cell(e.quote).slice(0, 180)} | ${e.confidence.toFixed(2)} | ${cell(e.origin)} |`,
  );
  return [
    "| 同学 | 目标 | 维度 | 水平 | 来源 | 引文/描述 | 置信度 | 来源类型 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

export function renderActivityReport(a: ActivityAssessment): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push("type: activity-report");
  lines.push("cssclasses:");
  lines.push("  - la-report");
  lines.push(`action_id: ${yamlScalar(a.activity_id)}`);
  lines.push(`title: ${yamlScalar(a.activity_title)}`);
  lines.push(`project: ${yamlScalar(a.activity_series || "")}`);
  lines.push(`activity_type: ${yamlScalar(a.activity_type)}`);
  lines.push(`date: ${yamlScalar(a.date)}`);
  lines.push(`mentor: ${yamlScalar(a.mentor)}`);
  lines.push(`generated_at: ${yamlScalar(a.generated_at)}`);
  lines.push(`model: ${yamlScalar(a.model)}`);
  lines.push(`report_version: "0.2.4"`);
  lines.push("---");
  lines.push("");
  const scope = a.activity_series ? `${a.activity_series} · ${a.activity_title}` : a.activity_title;
  lines.push(`# 行动成长报告（${scope}）`);
  lines.push("");
  lines.push(`> ${a.disclaimer}`);
  lines.push("");
  lines.push("## 一、行动概览");
  lines.push("");
  lines.push(a.overview || "（未生成）");
  lines.push("");
  lines.push("## 二、教学目标与证据覆盖");
  lines.push("");
  if (!a.goal_analysis.length) {
    lines.push("（导师未填写教学目标。）");
  } else {
    lines.push("| 教学目标 | 证据覆盖 | 说明 |");
    lines.push("| --- | --- | --- |");
    for (const g of a.goal_analysis) {
      lines.push(`| ${cell(g.goal)} | ${cell(g.coverage)} | ${cell(g.comment)} |`);
    }
  }
  lines.push("");
  lines.push("## 三、学员观察");
  lines.push("");
  if (!a.students.length) {
    lines.push("（没有学员记录。）");
  }
  for (const s of a.students) {
    lines.push(`### ${s.student}`);
    lines.push("");
    lines.push(`**概述**：${s.summary || "（未生成）"}`);
    lines.push("");
    if (s.evidence.length) {
      lines.push("**证据**");
      lines.push("");
      for (const e of s.evidence) {
        lines.push(evidenceBlock(e));
        lines.push("");
      }
    } else {
      lines.push("**证据**：本次未观察到可核验证据。");
      lines.push("");
    }
    if (s.strengths.length) {
      lines.push("**优势**");
      lines.push("");
      for (const item of s.strengths) lines.push(`- ${item}`);
      lines.push("");
    }
    if (s.next_steps.length) {
      lines.push("**下一步**");
      lines.push("");
      for (const item of s.next_steps) lines.push(`- ${item}`);
      lines.push("");
    }
    if (s.missing_evidence.length) {
      lines.push("**待补证据**");
      lines.push("");
      for (const item of s.missing_evidence) lines.push(`- ${item}`);
      lines.push("");
    }
  }
  lines.push("## 四、导师建议");
  lines.push("");
  if (a.mentor_suggestions.length) {
    for (const item of a.mentor_suggestions) lines.push(`- ${item}`);
  } else {
    lines.push("（未生成）");
  }
  lines.push("");
  lines.push("## 五、整体待补证据");
  lines.push("");
  if (a.missing_evidence.length) {
    for (const item of a.missing_evidence) lines.push(`- ${item}`);
  } else {
    lines.push("（无）");
  }
  lines.push("");
  if (a.evidence_photos?.length) {
    lines.push("## 附：证据照片");
    lines.push("");
    for (const photo of a.evidence_photos.slice(0, 12)) {
      lines.push(`![[${photo}]]`);
      lines.push("");
      lines.push(`> ${photo}`);
      lines.push("");
    }
  }
  lines.push("## 附：证据清单");
  lines.push("");
  lines.push(renderEvidenceTable(a.students.flatMap((s) => s.evidence)));
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`生成时间：${a.generated_at} ｜ 模型：${a.model}`);
  lines.push("");
  return lines.join("\n");
}

export function renderStageReport(s: StageAssessment): string {
  const lines: string[] = [];
  const title = s.report_title || "阶段性成长报告";
  const isSeries = s.report_kind === "series";
  lines.push("---");
  lines.push("type: stage-report");
  lines.push("cssclasses:");
  lines.push("  - la-report");
  lines.push(`report_kind: ${yamlScalar(s.report_kind || "stage")}`);
  lines.push(`student: ${yamlScalar(s.student)}`);
  lines.push(`period: ${yamlScalar(s.period)}`);
  lines.push(`generated_at: ${yamlScalar(s.generated_at)}`);
  lines.push(`model: ${yamlScalar(s.model)}`);
  lines.push(`report_version: "0.2.4"`);
  lines.push("---");
  lines.push("");
  const stageScope = isSeries ? `${s.period} · ${s.student}` : `${s.period} · ${s.student}`;
  lines.push(`# ${title}（${stageScope}）`);
  lines.push("");
  lines.push(`> ${s.disclaimer}`);
  lines.push("");
  lines.push(`**${isSeries ? "项目" : "阶段"}**：${s.period}`);
  lines.push("");
  lines.push(`## 一、${isSeries ? "项目" : "阶段"}概览`);
  lines.push("");
  lines.push(s.overview || "（未生成）");
  lines.push("");
  lines.push("## 二、素养目标进展");
  lines.push("");
  if (!s.goal_progress.length) {
    lines.push("（没有可对照的目标进展。）");
  } else {
    lines.push("| 素养目标/维度 | 当前水平 | 趋势 | 证据摘要 |");
    lines.push("| --- | --- | --- | --- |");
    for (const g of s.goal_progress) {
      lines.push(`| ${cell(g.goal)} | ${cell(g.level)} | ${cell(g.trend)} | ${cell(g.evidence_summary)} |`);
    }
  }
  lines.push("");
  lines.push("## 三、关键证据");
  lines.push("");
  if (s.evidence.length) {
    for (const e of s.evidence) {
      lines.push(evidenceBlock(e));
      lines.push("");
    }
  } else {
    lines.push("（本阶段没有可核验的跨活动证据。）");
  }
  lines.push("## 四、优势");
  lines.push("");
  if (s.strengths.length) {
    for (const item of s.strengths) lines.push(`- ${item}`);
  } else {
    lines.push("（未生成）");
  }
  lines.push("");
  lines.push("## 五、下一步建议");
  lines.push("");
  if (s.suggestions.length) {
    for (const item of s.suggestions) lines.push(`- ${item}`);
  } else {
    lines.push("（未生成）");
  }
  lines.push("");
  lines.push("## 六、待补证据");
  lines.push("");
  if (s.missing_evidence.length) {
    for (const item of s.missing_evidence) lines.push(`- ${item}`);
  } else {
    lines.push("（无）");
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`生成时间：${s.generated_at} ｜ 模型：${s.model}`);
  lines.push("");
  return lines.join("\n");
}

export function renderOverviewReport(o: OverviewAssessment): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push("type: overview-report");
  lines.push("cssclasses:");
  lines.push("  - la-report");
  lines.push(`report_kind: ${yamlScalar(o.report_kind)}`);
  lines.push(`scope: ${yamlScalar(o.scope)}`);
  lines.push(`period: ${yamlScalar(o.period)}`);
  lines.push(`generated_at: ${yamlScalar(o.generated_at)}`);
  lines.push(`model: ${yamlScalar(o.model)}`);
  lines.push(`report_version: "0.2.4"`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${o.report_title}（${o.scope}）`);
  lines.push("");
  lines.push(`> 周期：${o.period || "未填写"} ｜ 参与同学：${o.participants.length} 位 ｜ 覆盖行动：${o.action_count} 次`);
  lines.push(">");
  lines.push(`> ${o.disclaimer}`);
  lines.push("");
  lines.push("> [!summary] 一页摘要");
  for (const line of (o.overview || "（未生成）").split(/\r?\n/)) lines.push(`> ${line}`);
  lines.push("");
  lines.push('<div class="la-page-break"></div>');
  lines.push("");
  lines.push("## 一、项目一览");
  lines.push("");
  lines.push("| 指标 | 数值 |");
  lines.push("| --- | --- |");
  lines.push(`| 参与同学 | ${o.participants.length} 位 |`);
  lines.push(`| 覆盖行动 | ${o.action_count} 次 |`);
  lines.push(`| 可核验证据 | ${o.students.reduce((sum, s) => sum + s.evidence.length, 0)} 条 |`);
  lines.push(`| 报告周期 | ${cell(o.period || "未填写")} |`);
  lines.push("");
  lines.push("## 二、关键发现");
  lines.push("");
  if (o.highlights.length) {
    o.highlights.forEach((item, index) => {
      lines.push(`> [!insight] 发现 ${index + 1}`);
      lines.push(`> ${item}`);
      lines.push("");
    });
  } else {
    lines.push("（本次没有生成关键发现。）");
    lines.push("");
  }
  lines.push("## 三、素养目标进展");
  lines.push("");
  if (o.goal_progress.length) {
    lines.push("| 素养目标 / 维度 | 当前水平 | 趋势 | 证据摘要 |");
    lines.push("| --- | --- | --- | --- |");
    for (const goal of o.goal_progress) {
      lines.push(`| ${cell(goal.goal)} | ${cell(goal.level)} | ${cell(goal.trend)} | ${cell(goal.evidence_summary)} |`);
    }
  } else {
    lines.push("（没有可对照的目标进展。）");
  }
  lines.push("");
  lines.push("## 四、同学成长");
  lines.push("");
  if (!o.students.length) {
    lines.push("（没有同学记录。）");
  } else {
    o.students.forEach((student, index) => {
      lines.push(`### ${index + 1}. ${student.student}`);
      lines.push("");
      if (student.summary) lines.push(`> ${student.summary}`);
      lines.push("");
      if (student.highlights.length) {
        for (const item of student.highlights) lines.push(`- ${item}`);
        lines.push("");
      }
      if (student.evidence.length) {
        lines.push(renderEvidenceTable(student.evidence));
        lines.push("");
      } else {
        lines.push("（本周期还没有该同学的可核验证据。）");
        lines.push("");
      }
    });
  }
  lines.push("## 五、给项目 / 机构的建议");
  lines.push("");
  if (o.suggestions.length) {
    for (const item of o.suggestions) lines.push(`- ${item}`);
  } else {
    lines.push("（未生成）");
  }
  lines.push("");
  lines.push("## 六、方法与限制");
  lines.push("");
  lines.push("> [!warning] 阅读前请知道");
  lines.push("> 本报告由 AI 根据导师提供的观察、素材与行动报告汇总，导师确认后使用。");
  lines.push("> 没有证据的地方写「未观察到」，不代表同学不具备该素养。");
  lines.push("> 照片是否使用、是否打码，以监护人授权为准。");
  lines.push("");
  if (o.missing_evidence.length) {
    lines.push("**仍然缺少的证据**");
    lines.push("");
    for (const item of o.missing_evidence) lines.push(`- ${item}`);
    lines.push("");
  }
  if (o.evidence_photos?.length) {
    lines.push("## 附录：证据照片");
    lines.push("");
    for (const photo of o.evidence_photos.slice(0, 12)) {
      lines.push(`![[${photo}]]`);
      lines.push("");
      lines.push(`> ${photo}`);
      lines.push("");
    }
  }
  lines.push("## 附录：证据清单");
  lines.push("");
  lines.push(renderEvidenceTable(o.students.flatMap((student) => student.evidence)));
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`生成时间：${o.generated_at} ｜ 模型：${o.model} ｜ 模板：R1 机构报告`);
  lines.push("");
  return lines.join("\n");
}

export function renderEvidenceNote(a: ActivityAssessment): string {
  const items = a.students.flatMap((s) => s.evidence);
  return [
    "---",
    "type: evidence",
    `action_id: ${yamlScalar(a.activity_id)}`,
    `generated_at: ${yamlScalar(a.generated_at)}`,
    "---",
    "",
    `# 证据清单：${a.activity_title}`,
    "",
    `> ${a.disclaimer}`,
    "",
    renderEvidenceTable(items),
    "",
  ].join("\n");
}

