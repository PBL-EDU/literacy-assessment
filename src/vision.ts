/**
 * 图像理解：把本地图片缩放后转成 data URL，交给视觉模型写观察说明。
 */
import type { AssessmentSettings } from "./types";
import { AiError, chat, type ChatContentPart } from "./ai";
import { buildImageMessages } from "./prompt";
import { formatTimestamp } from "./core";

const MAX_RAW_BYTES = 8 * 1024 * 1024;
const MAX_DIM = 1600;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function resizeToJpeg(buffer: ArrayBuffer, mime: string): Promise<string | null> {
  try {
    const blob = new Blob([buffer], { type: mime });
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.body.createEl("canvas", { cls: "la-hidden-canvas" });
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      canvas.remove();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const url = canvas.toDataURL("image/jpeg", 0.85);
    canvas.remove();
    return url;
  } catch {
    return null;
  }
}

export async function imageToDataUrl(buffer: ArrayBuffer, mime: string): Promise<string> {
  const resized = await resizeToJpeg(buffer, mime);
  if (resized) return resized;
  if (buffer.byteLength > MAX_RAW_BYTES) {
    throw new AiError(`图片超过 ${MAX_RAW_BYTES / 1024 / 1024} MB 且无法在本地缩放，请压缩后再放入素材。`);
  }
  return `data:${mime};base64,${toBase64(buffer)}`;
}

function waitForEvent(element: HTMLVideoElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new AiError("读取视频超时，可能是编码不支持或文件损坏。"));
    }, timeoutMs);
    const cleanup = (): void => {
      window.clearTimeout(timer);
      element.removeEventListener(event, onReady);
      element.removeEventListener("error", onError);
    };
    const onReady = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new AiError("视频解码失败，可能是编码不被支持。"));
    };
    element.addEventListener(event, onReady, { once: true });
    element.addEventListener("error", onError, { once: true });
  });
}

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new AiError("视频跳转超时。"));
    }, 15_000);
    const cleanup = (): void => {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onSeekError);
    };
    const onSeeked = (): void => {
      cleanup();
      resolve();
    };
    const onSeekError = (): void => {
      cleanup();
      reject(new AiError("视频跳转失败。"));
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onSeekError, { once: true });
    const safeTime = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.1));
    if (Math.abs(video.currentTime - safeTime) < 0.05) {
      cleanup();
      resolve();
      return;
    }
    video.currentTime = safeTime;
  });
}

async function extractVideoFrames(
  buffer: ArrayBuffer,
  mime: string,
  count: number,
): Promise<Array<{ time: number; dataUrl: string }>> {
  const url = URL.createObjectURL(new Blob([buffer], { type: mime }));
  const video = document.body.createEl("video", { cls: "la-hidden-video" });
  video.src = url;
  video.muted = true;
  video.preload = "auto";
  try {
    if (video.readyState < 1) await waitForEvent(video, "loadedmetadata", 20_000);
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new AiError("读不到视频时长，无法抽关键帧。");
    }
    if (!video.videoWidth || !video.videoHeight) {
      throw new AiError("这个视频没有画面轨道（可能只有音频），已跳过画面说明。");
    }
    const times = Array.from({ length: count }, (_, index) => (duration * (index + 0.5)) / count);
    const frames: Array<{ time: number; dataUrl: string }> = [];
    for (const time of times) {
      await seekVideo(video, time);
      const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.body.createEl("canvas", { cls: "la-hidden-canvas" });
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        canvas.remove();
        throw new AiError("无法创建画布，抽帧失败。");
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push({ time, dataUrl: canvas.toDataURL("image/jpeg", 0.82) });
      canvas.remove();
    }
    return frames;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
    video.remove();
  }
}

export async function describeVideoFrames(
  settings: AssessmentSettings,
  buffer: ArrayBuffer,
  mime: string,
  fileName: string,
  frameCount = 3,
): Promise<string> {
  if (!settings.visionEnabled) throw new AiError("图像理解已在设置里关闭。");
  const frames = await extractVideoFrames(buffer, mime, Math.max(1, Math.min(6, frameCount)));
  if (!frames.length) throw new AiError("没有抽到可用的视频画面。");
  const parts: ChatContentPart[] = [
    {
      type: "text",
      text: `这是课堂视频「${fileName}」的 ${frames.length} 个关键帧（按时间顺序）。请描述：画面里能看到什么、孩子们在做什么、用了什么材料、有哪些协作或困难；看不清就写「看不清」。不要评价孩子的好坏，不要推测画面外的信息。输出 4-8 句中文。`,
    },
  ];
  for (const frame of frames) {
    parts.push({ type: "text", text: `【${formatTimestamp(frame.time)}】` });
    parts.push({ type: "image_url", image_url: { url: frame.dataUrl } });
  }
  const model = settings.visionModel.trim() || settings.aiModel;
  const raw = await chat(settings, [{ role: "user", content: parts }], {
    model,
    maxTokens: 900,
    temperature: 0.2,
    timeoutMs: Math.max(settings.aiTimeoutMs, 180_000),
  });
  return `视频关键帧（${frames.map((frame) => formatTimestamp(frame.time)).join(" / ")}）：\n${raw.trim()}`;
}

export async function describeImage(
  settings: AssessmentSettings,
  buffer: ArrayBuffer,
  mime: string,
  fileName: string,
): Promise<string> {
  if (!settings.visionEnabled) throw new AiError("图像理解已在设置里关闭。");
  const dataUrl = await imageToDataUrl(buffer, mime);
  const messages = buildImageMessages(fileName);
  const system = messages[0];
  const user = messages[1];
  if (!system || !user) throw new AiError("图像提示词缺失。");
  const parts: ChatContentPart[] = [
    { type: "text", text: user.content },
    { type: "image_url", image_url: { url: dataUrl } },
  ];
  const model = settings.visionModel.trim() || settings.aiModel;
  const raw = await chat(
    settings,
    [
      { role: "system", content: system.content },
      { role: "user", content: parts },
    ],
    { model, maxTokens: 800, temperature: 0.2, timeoutMs: Math.max(settings.aiTimeoutMs, 180_000) },
  );
  return raw.trim();
}
