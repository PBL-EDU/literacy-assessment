import { Modal, normalizePath, type App } from "obsidian";
import type { AssessmentSettings, FrameworkDefinition } from "./types";
import {
  frameworkRoot,
  frameworkSourceLabel,
  listFrameworks,
  parseFrameworkText,
} from "./framework";
import { sanitizeName } from "./core";
import { ensureFolder, pathExists, readText, writeText } from "./vault";

export interface FrameworkDiagnostic {
  framework: FrameworkDefinition;
  sourceLabel: string;
  hasHierarchy: boolean;
  issues: string[];
}

export async function frameworkDiagnostics(
  app: App,
  settings: AssessmentSettings,
): Promise<FrameworkDiagnostic[]> {
  const frameworks = await listFrameworks(app, settings);
  return frameworks.map((framework) => {
    const hasHierarchy = framework.goals.some((goal) => (goal.pathSegments?.length ?? 0) > 1);
    const issues = [...framework.errors];
    if (framework.goals.length > 0 && !hasHierarchy) {
      issues.push("所有目标都在一级：框架表建议增加「路径」列，才能形成多级目录。");
    }
    if (framework.goals.length > 0 && framework.goals.length <= 3) {
      issues.push(`只解析到 ${framework.goals.length} 个目标；请检查表格是否还有更多行，或文件是否只是示例框架。`);
    }
    return {
      framework,
      sourceLabel: frameworkSourceLabel(framework.source),
      hasHierarchy,
      issues,
    };
  });
}

/**
 * Import a plain Markdown framework into the local team framework folder.
 * No server call and no overwrite of the source file.
 */
export async function importFrameworkMarkdown(
  app: App,
  settings: AssessmentSettings,
  sourcePath: string,
): Promise<FrameworkDefinition> {
  const source = normalizePath(sourcePath);
  const text = await readText(app, source);
  const parsed = parseFrameworkText(source, text);
  if (!parsed.goals.length) {
    throw new Error(`框架没有解析到目标：${parsed.errors.join("；") || "请检查目标表和 level 列"}`);
  }
  const root = normalizePath(`${frameworkRoot(settings)}/_团队/导入`);
  await ensureFolder(app, root);
  let dest = normalizePath(`${root}/${sanitizeName(parsed.name || parsed.id)}.md`);
  if (dest === source) return parsed;
  let n = 2;
  while (await pathExists(app, dest)) {
    dest = normalizePath(`${root}/${sanitizeName(parsed.name || parsed.id)}-${n}.md`);
    n += 1;
  }
  await writeText(app, dest, text);
  return parseFrameworkText(dest, text);
}

export class FrameworkDiagnosticsModal extends Modal {
  constructor(
    app: App,
    private readonly items: FrameworkDiagnostic[],
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "素养框架诊断" });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: "这里显示插件实际解析到的框架、目标数和路径结构。目标树只显示框架文件里真实存在的目标。",
    });
    if (!this.items.length) {
      contentEl.createEl("p", { cls: "la-hint", text: "没有找到框架文件。" });
      return;
    }
    const list = contentEl.createDiv({ cls: "la-framework-diagnostics" });
    for (const item of this.items) {
      const card = list.createDiv({ cls: "la-framework-diagnostic" });
      card.createEl("h3", { text: item.framework.name });
      card.createEl("p", {
        text: `${item.sourceLabel} · v${item.framework.version} · ${item.framework.goals.length} 个目标 · ${item.framework.levels.length} 个 level`,
      });
      card.createEl("p", { cls: "la-hint", text: item.framework.path });
      if (!item.hasHierarchy) {
        card.createEl("p", { cls: "la-warning", text: "当前没有多级路径，目标会显示为一级。" });
      }
      for (const issue of item.issues) {
        card.createEl("p", { cls: "la-warning", text: issue });
      }
      if (item.framework.goals.length) {
        const details = card.createEl("details");
        details.createEl("summary", { text: "查看目标清单" });
        const ul = details.createEl("ul");
        for (const goal of item.framework.goals) {
          ul.createEl("li", { text: `${goal.id} ${goal.title}（${goal.path || "未设置路径"}）` });
        }
      }
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
