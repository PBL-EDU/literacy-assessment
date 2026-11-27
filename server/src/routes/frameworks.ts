import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import type { Db } from "../db/index.js";
import { requireMember } from "../auth/http.js";
import { requireAdmin } from "../auth/http.js";
import { adminPage, escapeHtml } from "../http/html.js";
import {
  disableFramework,
  getPublishedFramework,
  listFrameworkVersions,
  listPublishedFrameworks,
  publishFramework,
  uploadFramework,
} from "../frameworks/service.js";

const MAX_FRAMEWORK_BYTES = 2 * 1024 * 1024;

export async function registerFrameworkRoutes(app: FastifyInstance, db: Db, config: AppConfig): Promise<void> {
  app.get("/api/frameworks", async (request, reply) => {
    try {
      const auth = await requireMember(db, config, request);
      const frameworks = await listPublishedFrameworks(db, auth.org.id);
      return reply.send({
        frameworks: frameworks.map((framework) => ({
          frameworkId: framework.frameworkId,
          name: framework.name,
          version: framework.version,
          hash: framework.hash,
          markdown: framework.markdown,
        })),
      });
    } catch {
      return reply.code(401).send({ error: "未登录或成员已失效" });
    }
  });

  app.get("/api/frameworks/:frameworkId", async (request, reply) => {
    try {
      const auth = await requireMember(db, config, request);
      const params = request.params as { frameworkId: string };
      const framework = await getPublishedFramework(db, auth.org.id, params.frameworkId);
      if (!framework) return reply.code(404).send({ error: "框架不存在或未发布" });
      return reply.send({
        frameworkId: framework.frameworkId,
        name: framework.name,
        version: framework.version,
        hash: framework.hash,
        markdown: framework.markdown,
      });
    } catch {
      return reply.code(401).send({ error: "未登录或成员已失效" });
    }
  });

  app.get("/admin/frameworks", async (request, reply) => {
    const admin = await requireAdmin(db, request);
    return reply.type("text/html").send(await frameworkPage(db, admin, ""));
  });

  app.post("/admin/frameworks/upload", async (request, reply) => {
    const admin = await requireAdmin(db, request);
    if (!request.isMultipart()) {
      return reply.code(400).type("text/html").send(await frameworkPage(db, admin, "请上传 .md 文件"));
    }
    const file = await request.file({ limits: { fileSize: MAX_FRAMEWORK_BYTES } });
    if (!file) return reply.code(400).type("text/html").send(await frameworkPage(db, admin, "没有收到文件"));
    const buffer = await file.toBuffer();
    if (file.file.truncated) {
      return reply.code(413).type("text/html").send(await frameworkPage(db, admin, "文件超过 2 MB"));
    }
    try {
      await uploadFramework(db, admin, buffer.toString("utf8"));
      return reply.redirect("/admin/frameworks?uploaded=1");
    } catch (error) {
      return reply.code(400).type("text/html").send(await frameworkPage(db, admin, error instanceof Error ? error.message : "上传失败"));
    }
  });

  app.post("/admin/frameworks/:id/publish", async (request, reply) => {
    const admin = await requireAdmin(db, request);
    const params = request.params as { id: string };
    try {
      await publishFramework(db, admin, params.id);
      return reply.redirect("/admin/frameworks");
    } catch (error) {
      return reply.code(400).type("text/html").send(await frameworkPage(db, admin, error instanceof Error ? error.message : "发布失败"));
    }
  });

  app.post("/admin/frameworks/:id/disable", async (request, reply) => {
    const admin = await requireAdmin(db, request);
    const params = request.params as { id: string };
    await disableFramework(db, admin, params.id);
    return reply.redirect("/admin/frameworks");
  });
}

async function frameworkPage(
  db: Db,
  admin: Awaited<ReturnType<typeof requireAdmin>>,
  error: string,
): Promise<string> {
  const rows = await listFrameworkVersions(db, admin.org.id);
  const table = rows
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.name)}<br><span class="muted">${escapeHtml(row.framework_id)}</span></td>
        <td>${escapeHtml(row.version)}</td>
        <td>${escapeHtml(row.status)}</td>
        <td>${escapeHtml(row.file_hash.slice(0, 18))}…</td>
        <td>
          ${row.status !== "published" ? `<form method="post" action="/admin/frameworks/${row.id}/publish" style="display:inline"><button type="submit">发布</button></form>` : ""}
          ${row.status === "published" ? `<form method="post" action="/admin/frameworks/${row.id}/disable" style="display:inline"><button type="submit" style="background:#64748b">停用</button></form>` : ""}
        </td>
      </tr>`,
    )
    .join("");
  return adminPage(
    "框架",
    `<div class="card">
      <h1>标准框架</h1>
      <p><a href="/admin">返回总览</a> · <a href="/admin/invites">邀请教师</a></p>
      <p class="muted">上传学校团队工作坊产出的标准 Markdown。插件只读下载，不提供编辑。当前版本发布后，插件会下载最新发布版本。</p>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
      <form method="post" action="/admin/frameworks/upload" enctype="multipart/form-data">
        <label>框架 Markdown 文件</label>
        <input type="file" name="file" accept=".md,text/markdown" required>
        <p><button type="submit">校验并保存草稿</button></p>
      </form>
    </div>
    <div class="card">
      <h2>版本</h2>
      <table><tr><th>框架</th><th>版本</th><th>状态</th><th>Hash</th><th>操作</th></tr>${table || "<tr><td colspan='5'>还没有框架。</td></tr>"}</table>
    </div>`,
    admin.username,
  );
}
