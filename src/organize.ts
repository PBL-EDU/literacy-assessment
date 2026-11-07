/**
 * 素材扫描与 AI 整理：转写音频/视频，给图片写观察说明。
 */
import type { App } from "obsidian";
import type { ActivityRecord, AssessmentSettings } from "./types";
import { SUBFOLDERS } from "./types";
import { formatBytes, formatTimestamp, kindLabel, mimeForFile, nowISO, stemOf } from "./core";
import {
  getFullPath,
  listArtifacts,
  pathExists,
  readText,
  updateActivityStatus,
  writeText,
  yamlValue,
} from "./vault";
import { transcribeFile } from "./asr";
import { describeImage, describeVideoFrames } from "./vision";

export interface ProgressSink {
  status(message: string): void;
  log(message: string): void;
  cancelled(): boolean;
}

export interface ScanSummary {
  total: number;
  audio: number;
  video: number;
  image: number;
  text: number;
  document: number;
  transcribed: number;
  described: number;
}

export interface OrganizeSummary {
  transcribed: number;
  described: number;
  skipped: number;
  failed: number;
  notes: string[];
}

function transcriptPath(activityFolder: string, name: string): string {
  return `${activityFolder}/${SUBFOLDERS.transcripts}/${stemOf(name)}.md`;
}

function imageNotesPath(activityFolder: string): string {
  return `${activityFolder}/${SUBFOLDERS.transcripts}/图像说明.md`;
}

export function renderTranscriptMarkdown(name: string, result: Awaited<ReturnType<typeof transcribeFile>>): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push("type: transcript");
  lines.push(`source: ${yamlValue(`素材/${name}`)}`);
  lines.push(`model: ${yamlValue(result.model)}`);
  if (result.language) lines.push(`language: ${yamlValue(result.language)}`);
  if (result.duration) lines.push(`duration: ${result.duration}`);
  lines.push(`generated_at: ${yamlValue(nowISO())}`);
  lines.push("---");
  lines.push("");
  lines.push(`# 转写：${name}`);
  lines.push("");
  lines.push("> 由语音转写生成，可能有错字；引用前请导师对照原音核对。");
  lines.push("");
  if (result.segments.length) {
    lines.push("## 逐段");
    lines.push("");
    for (const segment of result.segments) {
      lines.push(`- **[${formatTimestamp(segment.start)} - ${formatTimestamp(segment.end)}]** ${segment.text}`);
    }
  } else {
    lines.push("## 全文");
    lines.push("");
    lines.push(result.text);
  }
  lines.push("");
  return lines.join("\n");
}

export async function scanActivity(
  app: App,
  settings: AssessmentSettings,
  record: ActivityRecord,
): Promise<ScanSummary> {
  const artifacts = await listArtifacts(app, record.folder);
  const summary: ScanSummary = {
    total: artifacts.length,
    audio: 0,
    video: 0,
    image: 0,
    text: 0,
    document: 0,
    transcribed: 0,
    described: 0,
  };
  for (const artifact of artifacts) {
    if (artifact.kind === "audio") summary.audio++;
    else if (artifact.kind === "video") summary.video++;
    else if (artifact.kind === "image") summary.image++;
    else if (artifact.kind === "text") summary.text++;
    else if (artifact.kind === "document") summary.document++;
    if (artifact.hasTranscript) summary.transcribed++;
    if (artifact.hasDescription) summary.described++;
  }

  const lines: string[] = [];
  lines.push("---");
  lines.push("type: material-list");
  lines.push(`action_id: ${yamlValue(record.meta.action_id)}`);
  lines.push(`generated_at: ${yamlValue(nowISO())}`);
  lines.push("---");
  lines.push("");
  lines.push(`# 素材清单：${record.meta.title}`);
  lines.push("");
  lines.push(
    `共 ${summary.total} 个文件：录音 ${summary.audio}、视频 ${summary.video}、图片 ${summary.image}、文字 ${summary.text}、文档 ${summary.document}。`,
  );
  lines.push("");
  if (!summary.total) {
    lines.push("> 素材/ 目录还是空的。把学习单、作品、录音、照片、视频放入后，再运行「扫描素材」。");
  } else {
    lines.push("| 文件 | 类型 | 大小 | 转写/说明 |");
    lines.push("| --- | --- | --- | --- |");
    for (const artifact of artifacts) {
      let status = "—";
      if (artifact.kind === "image") {
        status = artifact.hasDescription ? "✅ 已说明" : "— 待说明";
      } else if (artifact.kind === "audio" || artifact.kind === "video") {
        const done: string[] = [];
        if (artifact.hasTranscript) done.push("已转写");
        if (artifact.hasDescription) done.push("已说明画面");
        status = done.length ? `✅ ${done.join(" / ")}` : "— 待转写";
      } else if (artifact.kind === "document") {
        status = "⚠️ 需手动转文字/图片";
      }
      lines.push(`| ${artifact.name} | ${kindLabel(artifact.kind)} | ${formatBytes(artifact.size)} | ${status} |`);
    }
  }
  lines.push("");
  lines.push("> 下一步：运行「素养评估：AI 整理素材」，生成转写与图像说明。");
  lines.push("");
  await writeText(app, `${record.folder}/素材清单.md`, lines.join("\n"));
  await updateActivityStatus(app, record.folder, summary.total ? "待整理" : "收集中");
  return summary;
}

function appendDescription(
  existing: string,
  fileName: string,
  description: string,
  imagePath?: string,
): string {
  const header = existing.trim()
    ? existing
    : "# 图像说明\n\n> 由 AI 根据照片/学习单生成，导师可修改；看不清的地方以原图为准。\n\n";
  const heading = `## ${fileName}`;

  if (header.includes(heading)) {
    if (!imagePath) return header;
    const embed = `![[${imagePath}]]`;
    if (header.includes(embed)) return header;
    const index = header.indexOf(heading) + heading.length;
    return `${header.slice(0, index)}\n\n${embed}\n\n> 原图：\`${imagePath}\`\n${header.slice(index)}`;
  }

  const evidence = imagePath
    ? `![[${imagePath}]]\n\n> 原图：\`${imagePath}\`\n\n`
    : "";
  return `${header.trimEnd()}\n\n${heading}\n\n${evidence}${description.trim()}\n`;
}

export async function organizeActivity(
  app: App,
  settings: AssessmentSettings,
  record: ActivityRecord,
  progress: ProgressSink,
): Promise<OrganizeSummary> {
  const summary: OrganizeSummary = { transcribed: 0, described: 0, skipped: 0, failed: 0, notes: [] };
  const artifacts = await listArtifacts(app, record.folder);
  if (!artifacts.length) {
    throw new Error("素材/ 目录是空的。先把学习单、作品、录音、照片、视频放进去。");
  }

  const descriptionsPath = imageNotesPath(record.folder);
  let descriptions = (await pathExists(app, descriptionsPath)) ? await readText(app, descriptionsPath) : "";
  let imagesDone = 0;

  // 给已有图像说明补上原图佐证；旧文件也会在下次「AI 整理」时自动补齐。
  let descriptionsChanged = false;
  for (const artifact of artifacts) {
    if (artifact.kind !== "image" || !artifact.hasDescription) continue;
    const next = appendDescription(descriptions, artifact.name, "", artifact.path);
    if (next !== descriptions) {
      descriptions = next;
      descriptionsChanged = true;
    }
  }
  if (descriptionsChanged) await writeText(app, descriptionsPath, descriptions);

  for (const artifact of artifacts) {
    if (progress.cancelled()) {
      summary.notes.push("用户中止了整理。");
      break;
    }
    if (artifact.kind === "audio" || artifact.kind === "video") {
      if (!artifact.hasTranscript) {
        if (!settings.asrEnabled) {
          summary.skipped++;
          summary.notes.push(`${artifact.name}：语音转写已关闭，跳过。`);
        } else {
          progress.status(`转写 ${artifact.name}…`);
          progress.log(`开始转写：${artifact.name}（${formatBytes(artifact.size)}）`);
          try {
            const absolute = getFullPath(app, artifact.path);
            const result = await transcribeFile(settings, absolute, artifact.name);
            await writeText(app, transcriptPath(record.folder, artifact.name), renderTranscriptMarkdown(artifact.name, result));
            summary.transcribed++;
            progress.log(`完成：${artifact.name}（${result.segments.length} 段）`);
          } catch (error) {
            summary.failed++;
            const message = error instanceof Error ? error.message : String(error);
            summary.notes.push(`${artifact.name}：${message}`);
            progress.log(`失败：${artifact.name} —— ${message}`);
          }
        }
      }

      // 视频额外抽 3 个关键帧，交给视觉模型写画面说明
      if (artifact.kind === "video" && !artifact.hasDescription && settings.visionEnabled) {
        if (artifact.size > 200 * 1024 * 1024) {
          summary.skipped++;
          summary.notes.push(`${artifact.name}：视频超过 200 MB，跳过画面抽帧（避免内存不足）。`);
          continue;
        }
        progress.status(`描述视频画面 ${artifact.name}…`);
        progress.log(`开始视频关键帧说明：${artifact.name}`);
        try {
          const binary = await app.vault.adapter.readBinary(artifact.path);
          const description = await describeVideoFrames(settings, binary, mimeForFile(artifact.name), artifact.name, 3);
          descriptions = appendDescription(descriptions, artifact.name, description);
          await writeText(app, descriptionsPath, descriptions);
          summary.described++;
          progress.log(`视频画面完成：${artifact.name}`);
        } catch (error) {
          summary.failed++;
          const message = error instanceof Error ? error.message : String(error);
          summary.notes.push(`${artifact.name}：${message}`);
          progress.log(`视频画面失败：${artifact.name} —— ${message}`);
        }
      }
      continue;
    }

    if (artifact.kind === "image") {
      if (artifact.hasDescription) continue;
      if (!settings.visionEnabled) {
        summary.skipped++;
        summary.notes.push(`${artifact.name}：图像理解已关闭，跳过。`);
        continue;
      }
      if (artifact.size > 20 * 1024 * 1024) {
        summary.skipped++;
        summary.notes.push(`${artifact.name}：图片超过 20 MB，建议先压缩再放进来。`);
        continue;
      }
      if (imagesDone >= settings.visionMaxImages) {
        summary.skipped++;
        summary.notes.push(`${artifact.name}：本次最多处理 ${settings.visionMaxImages} 张图片，剩余下次再跑。`);
        continue;
      }
      progress.status(`描述 ${artifact.name}…`);
      progress.log(`开始图像说明：${artifact.name}`);
      try {
        const binary = await app.vault.adapter.readBinary(artifact.path);
        const description = await describeImage(settings, binary, mimeForFile(artifact.name), artifact.name);
        descriptions = appendDescription(descriptions, artifact.name, description, artifact.path);
        await writeText(app, descriptionsPath, descriptions);
        summary.described++;
        imagesDone++;
        progress.log(`完成：${artifact.name}`);
      } catch (error) {
        summary.failed++;
        const message = error instanceof Error ? error.message : String(error);
        summary.notes.push(`${artifact.name}：${message}`);
        progress.log(`失败：${artifact.name} —— ${message}`);
      }
      continue;
    }

    if (artifact.kind === "document") {
      summary.skipped++;
      summary.notes.push(`${artifact.name}：PDF/Word 暂不自动转写，请导出为图片或文字后再跑。`);
    }
  }

  await scanActivity(app, settings, record);
  await updateActivityStatus(app, record.folder, summary.failed ? "部分整理" : "已整理");
  progress.status(
    `整理完成：转写 ${summary.transcribed}，图像说明 ${summary.described}，跳过 ${summary.skipped}，失败 ${summary.failed}。`,
  );
  for (const note of summary.notes) progress.log(note);
  return summary;
}
