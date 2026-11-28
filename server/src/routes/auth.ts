/* eslint-disable */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Db } from "../db/index.js";
import { requireMember } from "../auth/http.js";
import { adminLogout, adminLogin, assignTeacherTeam, createInvite, createTeam, createTeacher, redeemInvite, refreshSession, revokeDevice, type AdminContext } from "../auth/service.js";
import { adminPage, escapeHtml } from "../http/html.js";
import { optionalAdmin, requireAdmin } from "../auth/http.js";

const redeemSchema = z.object({
  code: z.string().min(8).max(24),
  displayName: z.string().min(1).max(40),
  deviceName: z.string().min(1).max(80).optional().default("Obsidian"),
});

const refreshSchema = z.object({ refreshToken: z.string().min(20) });

const loginSchema = z.object({
  username: z.string().min(1).max(80),
  password: z.string().min(1).max(200),
  totp: z.string().optional(),
});

const inviteSchema = z.object({
  expiresInHours: z.coerce.number().int().min(1).max(24 * 30).default(24 * 7),
  maxUses: z.coerce.number().int().min(1).max(100).default(1),
  teacherId: z.string().optional().default(""),
  teamId: z.string().optional().default(""),
});

const teamSchema = z.object({
  name: z.string().min(1).max(80),
});

const teacherSchema = z.object({
  name: z.string().min(1).max(40),
  teamId: z.string().min(1),
  role: z.enum(["teacher", "mentor"]).default("teacher"),
});

export async function registerAuthRoutes(app: FastifyInstance, db: Db, config: AppConfig): Promise<void> {
  app.post("/api/auth/redeem-invite", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const input = redeemSchema.safeParse(request.body ?? {});
    if (!input.success) return reply.code(400).send({ error: "请求参数不正确" });
    try {
      const bundle = await redeemInvite(db, config, input.data);
      return reply.send(bundle);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "加入组织失败" });
    }
  });

  app.post("/api/auth/refresh", async (request, reply) => {
    const input = refreshSchema.safeParse(request.body ?? {});
    if (!input.success) return reply.code(400).send({ error: "请求参数不正确" });
    try {
      return reply.send(await refreshSession(db, config, input.data.refreshToken));
    } catch (error) {
      return reply.code(401).send({ error: error instanceof Error ? error.message : "会话已失效" });
    }
  });

  app.get("/api/me", async (request, reply) => {
    try {
      const auth = await requireMember(db, config, request);
      return reply.send({ org: auth.org, member: auth.member });
    } catch {
      return reply.code(401).send({ error: "未登录或成员已失效" });
    }
  });

  app.post("/api/auth/logout", async (request, reply) => {
    try {
      const auth = await requireMember(db, config, request);
      await revokeDevice(db, auth.member.id, auth.deviceId);
      return reply.send({ ok: true });
    } catch {
      return reply.code(401).send({ error: "未登录" });
    }
  });

  app.get("/admin/login", async (_request, reply) => {
    return reply.type("text/html").send(
      adminPage(
        "管理员登录",
        `<div class="card" style="max-width:420px;margin:8vh auto">
          <h1>组织后台登录</h1>
          <p class="muted">仅组织管理员使用。教师请在 Obsidian 插件中用邀请码加入。</p>
          <form method="post" action="/admin/login">
            <label>用户名</label><input type="text" name="username" autocomplete="username" required>
            <label>密码</label><input type="password" name="password" autocomplete="current-password" required>
            <label>TOTP（如已开启）</label><input type="text" name="totp" inputmode="numeric" autocomplete="one-time-code">
            <p><button type="submit">登录</button></p>
          </form>
        </div>`,
      ),
    );
  });

  app.post("/admin/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const input = loginSchema.safeParse(request.body ?? {});
    if (!input.success) {
      return reply.code(400).type("text/html").send(adminPage("登录失败", `<div class="card"><p class="error">请求参数不正确。</p></div>`));
    }
    try {
      const session = await adminLogin(db, config, input.data.username, input.data.password, input.data.totp);
      // TOTP verification is intentionally a follow-up once the admin enables it;
      // the login endpoint already rejects accounts without an active org/session.
      reply.setCookie("la_admin", session.token, {
        path: "/admin",
        httpOnly: true,
        sameSite: "strict",
        secure: config.adminCookieSecure,
        maxAge: 12 * 60 * 60,
      });
      return reply.redirect("/admin");
    } catch {
      return reply.code(401).type("text/html").send(
        adminPage("登录失败", `<div class="card"><p class="error">用户名或密码不正确。</p></div>`),
      );
    }
  });

  app.get("/admin/logout", async (request, reply) => {
    await adminLogout(db, request.cookies?.la_admin ?? "");
    reply.clearCookie("la_admin", { path: "/admin" });
    return reply.redirect("/admin/login");
  });

  app.get("/admin", async (request, reply) => {
    const admin = await requireAdmin(db, request);
    const [members, teams, invites, frameworks, usage] = await Promise.all([
      db.query("SELECT count(*)::int AS count FROM members WHERE org_id = $1 AND status = 'active'", [admin.org.id]),
      db.query("SELECT count(*)::int AS count FROM teams WHERE org_id = $1 AND status = 'active'", [admin.org.id]),
      db.query("SELECT count(*)::int AS count FROM invites WHERE org_id = $1 AND used_count < max_uses AND expires_at > now()", [admin.org.id]),
      db.query("SELECT count(*)::int AS count FROM framework_versions WHERE org_id = $1 AND status = 'published'", [admin.org.id]),
      db.query(
        "SELECT coalesce(sum(estimated_cost_cny),0)::numeric(12,4) AS cost FROM usage_events WHERE org_id = $1 AND created_at >= date_trunc('month', now())",
        [admin.org.id],
      ),
    ]);
    return reply.type("text/html").send(
      adminPage(
        "总览",
        `<div class="card">
          <h1>${escapeHtml(admin.org.name)}</h1>
          <p class="muted">当前组织后台。v0.5.0 管理界面会逐步补齐成员、框架、用量与设置。</p>
          <table>
            <tr><th>活跃教师</th><th>团队</th><th>可用邀请码</th><th>已发布框架</th><th>本月估算用量</th></tr>
            <tr><td>${members.rows[0]?.count ?? 0}</td><td>${teams.rows[0]?.count ?? 0}</td><td>${invites.rows[0]?.count ?? 0}</td><td>${frameworks.rows[0]?.count ?? 0}</td><td>¥${usage.rows[0]?.cost ?? "0"}</td></tr>
          </table>
        </div>
        <div class="card"><h2>快捷入口</h2><p><a href="/admin/teams">团队</a> · <a href="/admin/teachers">教师</a> · <a href="/admin/invites">邀请教师</a> · <a href="/admin/members">成员</a> · <a href="/admin/frameworks">框架</a> · <a href="/admin/settings">组织设置</a> · <a href="/admin/prices">模型价格</a> · <a href="/admin/logout">退出登录</a></p></div>`,
        admin.username,
      ),
    );
  });

  app.get("/admin/members", async (request, reply) => {
    const admin = await requireAdmin(db, request);
    const members = await db.query(
      `SELECT m.display_name, m.role, m.status, m.created_at, m.team_name,
              count(d.id) FILTER (WHERE d.revoked_at IS NULL)::int AS active_devices
       FROM members m
       LEFT JOIN devices d ON d.member_id = m.id
       WHERE m.org_id = $1
       GROUP BY m.id ORDER BY m.created_at DESC`,
      [admin.org.id],
    );
    const rows = members.rows
      .map(
        (row) => `<tr><td>${escapeHtml(row.display_name)}</td><td>${escapeHtml(row.team_name ?? "—")}</td><td>${escapeHtml(row.role)}</td><td>${escapeHtml(row.status)}</td><td>${row.active_devices}</td><td>${new Date(row.created_at).toLocaleDateString("zh-CN")}</td></tr>`,
      )
      .join("");
    return reply.type("text/html").send(
      adminPage(
        "成员",
        `<div class="card"><h1>成员</h1><p><a href="/admin">返回总览</a> · <a href="/admin/invites">邀请教师</a></p>
        <table><tr><th>姓名</th><th>团队</th><th>角色</th><th>状态</th><th>有效设备</th><th>加入时间</th></tr>${rows || "<tr><td colspan='6'>还没有成员。</td></tr>"}</table></div>`,
        admin.username,
      ),
    );
  });

  app.get("/admin/invites", async (request, reply) => {
    const admin = await requireAdmin(db, request);
    return reply.type("text/html").send(await invitePage(db, admin, ""));
  });

  app.post("/admin/invites", async (request, reply) => {
    const admin = await requireAdmin(db, request);
    const input = inviteSchema.safeParse(request.body ?? {});
    if (!input.success) {
      return reply.code(400).type("text/html").send(await invitePage(db, admin, "参数不正确"));
    }
    try {
      const invite = await createInvite(db, admin, {
        expiresInHours: input.data.expiresInHours,
        maxUses: input.data.maxUses,
        teacherId: input.data.teacherId || undefined,
        teamId: input.data.teamId || undefined,
      });
      return reply.type("text/html").send(await invitePage(db, admin, "", invite.code, invite.expiresAt, invite.teacherName, invite.teamName));
    } catch (error) {
      return reply.code(400).type("text/html").send(await invitePage(db, admin, error instanceof Error ? error.message : String(error)));
    }
  });

  app.get("/admin/teams", async (request, reply) => {
    const admin = await requireAdmin(db, request);
    const teams = await db.query(
      "SELECT id, name, status, created_at FROM teams WHERE org_id = $1 ORDER BY name",
      [admin.org.id],
    );
    const rows = teams.rows.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.status)}</td><td>${new Date(row.created_at).toLocaleDateString("zh-CN")}</td></tr>`).join("");
    return reply.type("text/html").send(adminPage(
      "团队",
      `<div class="card"><h1>团队</h1><p><a href="/admin">返回总览</a> · <a href="/admin/teachers">教师</a></p>
       <form method="post" action="/admin/teams"><label>团队名称</label><input name="name" maxlength="80" required><p><button type="submit">添加团队</button></p></form>
       <table><tr><th>名称</th><th>状态</th><th>创建时间</th></tr>${rows || "<tr><td colspan='3'>还没有团队。</td></tr>"}</table></div>`,
      admin.username,
    ));
  });

  app.post("/admin/teams", async (request, reply) => {
    const admin = await requireAdmin(db, request);
    const input = teamSchema.safeParse(request.body ?? {});
    if (!input.success) return reply.code(400).type("text/html").send(adminPage("参数错误", `<div class="card"><p class="error">团队名称不合法。</p></div>`, admin.username));
    try {
      await createTeam(db, admin, input.data.name);
    } catch (error) {
      return reply.code(400).type("text/html").send(adminPage("创建失败", `<div class="card"><p class="error">${escapeHtml(error instanceof Error ? error.message : String(error))}</p></div>`, admin.username));
    }
    return reply.redirect("/admin/teams");
  });

  app.get("/admin/teachers", async (request, reply) => {
    const admin = await requireAdmin(db, request);
    const [teams, teachers] = await Promise.all([
      db.query("SELECT id, name FROM teams WHERE org_id = $1 AND status = 'active' ORDER BY name", [admin.org.id]),
      db.query(
        `SELECT m.id, m.display_name, m.role, m.status, m.team_name, count(d.id) FILTER (WHERE d.revoked_at IS NULL)::int AS devices
         FROM members m LEFT JOIN devices d ON d.member_id = m.id
         WHERE m.org_id = $1 GROUP BY m.id ORDER BY m.team_name NULLS LAST, m.display_name`,
        [admin.org.id],
      ),
    ]);
    const teamOptions = teams.rows.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.name)}</option>`).join("");
    const rows = teachers.rows.map((row) => `<tr><td>${escapeHtml(row.display_name)}</td><td>${escapeHtml(row.team_name ?? "—")}</td><td>${escapeHtml(row.role)}</td><td>${escapeHtml(row.status)}</td><td>${row.devices}</td><td><form method="post" action="/admin/teachers/team" style="display:flex;gap:4px"><input type="hidden" name="memberId" value="${escapeHtml(row.id)}"><select name="teamId">${teamOptions}</select><button type="submit">分配</button></form></td></tr>`).join("");
    return reply.type("text/html").send(adminPage(
      "教师",
      `<div class="card"><h1>教师</h1><p><a href="/admin">返回总览</a> · <a href="/admin/teams">团队</a> · <a href="/admin/invites">邀请码</a></p>
       ${teamOptions ? `<form method="post" action="/admin/teachers"><label>教师姓名</label><input name="name" maxlength="40" required>
       <label>所属团队</label><select name="teamId" required>${teamOptions}</select>
       <label>角色</label><select name="role"><option value="teacher">教师</option><option value="mentor">导师</option></select>
       <p><button type="submit">创建教师</button></p></form>` : `<p class="muted">请先创建团队。</p>`}
       <table><tr><th>姓名</th><th>团队</th><th>角色</th><th>状态</th><th>设备</th><th>分配团队</th></tr>${rows || "<tr><td colspan='6'>还没有教师。</td></tr>"}</table></div>`,
      admin.username,
    ));
  });

  app.post("/admin/teachers", async (request, reply) => {
    const admin = await requireAdmin(db, request);
    const input = teacherSchema.safeParse(request.body ?? {});
    if (!input.success) return reply.code(400).type("text/html").send(adminPage("参数错误", `<div class="card"><p class="error">教师信息不合法。</p></div>`, admin.username));
    try {
      await createTeacher(db, admin, input.data);
    } catch (error) {
      return reply.code(400).type("text/html").send(adminPage("创建失败", `<div class="card"><p class="error">${escapeHtml(error instanceof Error ? error.message : String(error))}</p></div>`, admin.username));
    }
    return reply.redirect("/admin/teachers");
  });

  app.post("/admin/teachers/team", async (request, reply) => {
    const admin = await requireAdmin(db, request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const memberId = typeof body.memberId === "string" ? body.memberId : "";
    const teamId = typeof body.teamId === "string" ? body.teamId : "";
    try {
      await assignTeacherTeam(db, admin, memberId, teamId);
    } catch (error) {
      return reply.code(400).type("text/html").send(adminPage("分配团队失败", `<div class="card"><p class="error">${escapeHtml(error instanceof Error ? error.message : String(error))}</p></div>`, admin.username));
    }
    return reply.redirect("/admin/teachers");
  });

  app.get("/admin/login-check", async (request, reply) => {
    const admin = await optionalAdmin(db, request);
    return reply.send({ authenticated: Boolean(admin) });
  });
}

async function invitePage(
  db: Db,
  admin: AdminContext,
  error: string,
  code = "",
  expiresAt?: Date,
  teacherName = "",
  teamName = "",
): Promise<string> {
  const [teachers, teams] = await Promise.all([
    db.query(
      `SELECT id, display_name, team_id, team_name FROM members
       WHERE org_id = $1 AND status = 'active' ORDER BY team_name NULLS LAST, display_name`,
      [admin.org.id],
    ),
    db.query(
      "SELECT id, name FROM teams WHERE org_id = $1 AND status = 'active' ORDER BY name",
      [admin.org.id],
    ),
  ]);
  const teacherOptions = teachers.rows
    .map((row) => `<option value="${escapeHtml(row.id)}" data-team="${escapeHtml(row.team_id ?? "")}">${escapeHtml(row.display_name)} · ${escapeHtml(row.team_name ?? "未分团队")}</option>`)
    .join("");
  const teamOptions = teams.rows
    .map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.name)}</option>`)
    .join("");
  return adminPage(
    "邀请教师",
    `<div class="card">
      <h1>邀请教师</h1>
      <p><a href="/admin">返回总览</a> · <a href="/admin/teachers">教师</a> · <a href="/admin/teams">团队</a></p>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
      ${code ? `<p class="ok">邀请码：<b style="font-size:22px;letter-spacing:.12em">${escapeHtml(code)}</b><br><span class="muted">${escapeHtml(teacherName)} · ${escapeHtml(teamName)} · 有效期至 ${escapeHtml(expiresAt?.toLocaleString("zh-CN"))}；仅可使用一次。</span></p>` : ""}
      ${teacherOptions ? `<form method="post" action="/admin/invites">
        <label>教师</label><select name="teacherId" required>${teacherOptions}</select>
        <label>所属团队</label><select name="teamId" required>${teamOptions}</select>
        <label>有效期（小时）</label><input type="number" name="expiresInHours" value="168" min="1" max="720">
        <label>最多使用次数</label><input type="number" name="maxUses" value="1" min="1" max="100">
        <p><button type="submit">生成邀请码</button></p>
      </form>` : `<p class="muted">请先在「教师」页创建教师。</p>`}
      <p class="muted">邀请码绑定教师姓名和团队；教师在 Obsidian 插件中只需输入邀请码和设备名，姓名/团队由服务端返回。</p>
    </div>`,
    admin.username,
  );
}
