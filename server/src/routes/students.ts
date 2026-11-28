import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import type { Db } from "../db/index.js";
import { requireAdmin, requireMember } from "../auth/http.js";
import { adminPage, escapeHtml } from "../http/html.js";
import { listOrgStudentSummaries, listTeamStudentSummaries, syncStudentSummaries } from "../students/service.js";

export async function registerStudentRoutes(app: FastifyInstance, db: Db, config: AppConfig): Promise<void> {
  app.get("/api/students", async (request, reply) => {
    try {
      const auth = await requireMember(db, config, request);
      if (!auth.member.teamId) return reply.send({ students: [], teamName: "" });
      const rows = await listTeamStudentSummaries(db, auth.org.id, auth.member.teamId);
      return reply.send({ students: rows, teamName: auth.member.teamName ?? "" });
    } catch {
      return reply.code(401).send({ error: "未登录或成员已失效" });
    }
  });

  app.post("/api/students/sync", async (request, reply) => {
    try {
      const auth = await requireMember(db, config, request);
      const body = (request.body ?? {}) as { students?: unknown };
      const result = await syncStudentSummaries(db, auth, body.students);
      return reply.send({ ok: true, ...result });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode ?? 400;
      return reply.code(statusCode).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/admin/students", async (request, reply) => {
    const admin = await requireAdmin(db, request);
    const rows = await listOrgStudentSummaries(db, admin.org.id);
    const byStudent = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byStudent.get(row.id) ?? [];
      list.push(row);
      byStudent.set(row.id, list);
    }
    const table = [...byStudent.values()].map((items) => {
      const first = items[0];
      const mentors = items.map((item) => item.memberName).join("、");
      const levels = items.flatMap((item) => item.currentLevels).slice(0, 8)
        .map((level) => `${escapeHtml(level.goal)} ${escapeHtml(level.level)}`).join("；");
      return `<tr><td>${escapeHtml(first.name)}</td><td>${escapeHtml(first.teamName)}</td><td>${escapeHtml(mentors)}</td><td>${levels || "—"}</td><td>${items.reduce((sum, item) => sum + item.activityCount, 0)}</td><td>${items.reduce((sum, item) => sum + item.evidenceCount, 0)}</td><td>${first.lastActivityAt ? new Date(first.lastActivityAt).toLocaleDateString("zh-CN") : "—"}</td></tr>`;
    }).join("");
    return reply.type("text/html").send(adminPage(
      "同学目录",
      `<div class="card"><h1>同学目录</h1><p><a href="/admin">返回总览</a> · <a href="/admin/teams">团队</a></p>
       <p class="muted">只汇总导师主动同步的姓名、团队、当前 level、活动数、证据数和摘要；原始素材和报告正文不上传。</p>
       <table><tr><th>同学</th><th>团队</th><th>导师</th><th>当前 level</th><th>活动</th><th>证据</th><th>最近活动</th></tr>${table || "<tr><td colspan='7'>还没有导师同步同学摘要。</td></tr>"}</table></div>`,
      admin.username,
    ));
  });
}
