/**
 * 组织框架签名 bundle（本地文件，不依赖服务器）。
 * bundle 是一个 JSON：manifest + Markdown 内容 + 签名。
 */
import type { App } from "obsidian";
import { normalizePath } from "obsidian";
import { createHash, createPublicKey, verify } from "crypto";
import type { AssessmentSettings } from "./types";
import { pathExists, readText, writeText, ensureFolder } from "./vault";
import { frameworkRoot } from "./framework";

export interface FrameworkBundle {
  manifest: {
    framework_id: string;
    version: string;
    org_id: string;
    hash: string;
    signature: string;
    public_key: string;
  };
  content: string;
}

export interface BundleVerification {
  ok: boolean;
  reason: string;
  hash: string;
  manifest?: FrameworkBundle["manifest"];
}

function sha256(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function canonicalPayload(bundle: FrameworkBundle): string {
  return JSON.stringify({
    framework_id: bundle.manifest.framework_id,
    version: bundle.manifest.version,
    org_id: bundle.manifest.org_id,
    hash: bundle.manifest.hash,
  });
}

export function verifyBundle(bundle: FrameworkBundle): BundleVerification {
  const hash = sha256(bundle.content);
  if (bundle.manifest.hash !== hash) {
    return { ok: false, reason: "框架内容 hash 不一致，可能被修改", hash };
  }
  try {
    const key = createPublicKey(bundle.manifest.public_key);
    const ok = verify(
      null,
      Buffer.from(canonicalPayload(bundle), "utf8"),
      key,
      Buffer.from(bundle.manifest.signature, "base64"),
    );
    return {
      ok,
      reason: ok ? "签名校验通过" : "签名校验失败",
      hash,
      manifest: bundle.manifest,
    };
  } catch (error) {
    return { ok: false, reason: `公钥/签名格式错误：${error instanceof Error ? error.message : String(error)}`, hash };
  }
}

export function bundlePath(settings: AssessmentSettings, frameworkId: string): string {
  return `${frameworkRoot(settings)}/${frameworkId}.md`;
}

export async function installBundle(
  app: App,
  settings: AssessmentSettings,
  bundle: FrameworkBundle,
): Promise<string> {
  const result = verifyBundle(bundle);
  if (!result.ok) throw new Error(result.reason);
  const path = normalizePath(bundlePath(settings, bundle.manifest.framework_id));
  await writeText(app, path, bundle.content);
  const manifestDir = `${frameworkRoot(settings)}/_组织/${bundle.manifest.org_id}`;
  await ensureFolder(app, manifestDir);
  await writeText(app, `${manifestDir}/${bundle.manifest.framework_id}.manifest.json`, `${JSON.stringify(bundle.manifest, null, 2)}\n`);
  await writeText(app, `${manifestDir}/${bundle.manifest.framework_id}.public-key.pem`, bundle.manifest.public_key);
  return path;
}

export async function installBundleFromVault(
  app: App,
  settings: AssessmentSettings,
  bundleVaultPath: string,
): Promise<string> {
  const path = normalizePath(bundleVaultPath);
  if (!(await pathExists(app, path))) throw new Error(`找不到 bundle：${path}`);
  let bundle: FrameworkBundle;
  try {
    bundle = JSON.parse(await readText(app, path)) as FrameworkBundle;
  } catch {
    throw new Error("bundle 不是合法 JSON。");
  }
  if (!bundle.manifest || !bundle.content) throw new Error("bundle 缺少 manifest/content。");
  return installBundle(app, settings, bundle);
}

export async function verifyInstalledBundle(
  app: App,
  settings: AssessmentSettings,
  frameworkId: string,
  orgId: string,
): Promise<BundleVerification | null> {
  const manifestPath = `${frameworkRoot(settings)}/_组织/${orgId}/${frameworkId}.manifest.json`;
  if (!(await pathExists(app, manifestPath))) return null;
  const contentPath = bundlePath(settings, frameworkId);
  if (!(await pathExists(app, contentPath))) return { ok: false, reason: "框架文件缺失", hash: "" };
  const manifest = JSON.parse(await readText(app, manifestPath)) as FrameworkBundle["manifest"];
  const content = await readText(app, contentPath);
  const hash = sha256(content);
  if (hash !== manifest.hash) return { ok: false, reason: "本地框架被修改，需要重新导入组织 bundle", hash, manifest };
  return { ok: true, reason: "hash 与组织 bundle 一致", hash, manifest };
}
