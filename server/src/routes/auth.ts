/* eslint-disable */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Db } from "../db/index.js";
import { requireMember } from "../auth/http.js";
import { adminLogout, adminLogin, assignTeamLead, assignTeacherTeam, createInvite, createTeam, createTeacher, createTenant, createTenantAdmin, redeemInvite, refreshSession, resetTenantAdminPassword, revokeDevice, revokeMemberDevices, setTenantAdminStatus, switchAdminTenant, updateTeacher, updateTeam, type AdminContext } from "../auth/service.js";
import { adminPage, escapeHtml } from "../http/html.js";
import { optionalAdmin, requireAdmin, requirePlatformAdmin } from "../auth/http.js";

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

const tenantSchema = z.object({
  name: z.string().min(1).max(80),
  adminUsername: z.string().min(3).max(60),
  adminPassword: z.string().min(12).max(200),
  monthlyBudgetCny: z.coerce.number().min(0).max(100000000).default(0),
});

const teacherSchema = z.object({
  name: z.string().min(1).max(40),
  teamId: z.string().min(1),
  role: z.enum(["teacher", "mentor"]).default("teacher"),
});

const teamUpdateSchema = z.object({
  teamId: z.string().min(1),
  name: z.string().min(1).max(80),
  status: z.enum(["active", "disabled"]),
});

const teacherUpdateSchema = z.object({
  memberId: z.string().min(1),
  name: z.string().min(1).max(40),
  status: z.enum(["active", "disabled"]),
  teamId: z.string().optional().default(""),
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
      return reply.code(401).send({ error: "未登录或导师已失效" });
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
          <p class="muted">仅组织管理员使用。导师请在 Obsidian 插件中用邀请码加入。</p>
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
          <p class="muted">当前组织后台。v0.5.0 管理界面会逐步补齐导师、框架、用量与设置。</p>
          <table>
            <tr><th>活跃导师</th><th>团队</th><th>可用邀请码</th><th>已发布框架</th><th>本月估算用量</th></tr>
            <tr><td>${members.rows[0]?.count ?? 0}</td><td>${teams.rows[0]?.count ?? 0}</td><td>${invites.rows[0]?.count ?? 0}</td><td>${frameworks.rows[0]?.count ?? 0}</td><td>¥${usage.rows[0]?.cost ?? "0"}</td></tr>
          </table>
        </div>
        <div class="card"><h2>快捷入口</h2><p>${admin.isPlatformAdmin ? '<a href="/admin/tenants">组织</a> · ' : ''}<a href="/admin/teams">团队</a> · <a href="/admin/teachers">导师</a> · <a href="/admin/invites">邀请导师</a> · <a href="/admin/members">导师</a> · <a href="/admin/frameworks">框架</a> · <a href="/admin/usage">用量</a> · <a href="/admin/settings">组织设置</a> · <a href="/admin/prices">模型价格</a> · <a href="/admin/logout">退出登录</a></p></div>`,
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
        "导师",
        `<div class="card"><h1>导师</h1><p><a href="/admin">返回总览</a> · <a href="/admin/invites">邀请导师</a></p>
       <table><tr><th>姓名</th><th>团队</th><th>角色</th><th>状态</th><th>设备</th><th>编辑/设备</th></tr>${rows || "<tr><td colspan='6'>还没有导师。</td></tr>"}</table></div>`,
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
    const [teams, members] = await Promise.all([
      db.query(
        "SELECT id, name, status, lead_member_id, created_at FROM teams WHERE org_id = $1 ORDER BY name",
        [admin.org.id],
      ),
      db.query(
        "SELECT id, display_name, team_id, status FROM members WHERE org_id = $1 AND status = 'active' ORDER BY display_name",
        [admin.org.id],
      ),
    ]);
    const memberRows = members.rows;
    const rows = teams.rows.map((row) => {
      const lead = memberRows.find((m) => String(m.id) === String(row.lead_member_id));
      const options = [`<option value="">未指定</option>`]
        .concat(memberRows.filter((m) => String(m.team_id) === String(row.id)).map((m) => `<option value="${escapeHtml(m.id)}"${String(m.id) === String(row.lead_member_id) ? " selected" : ""}>${escapeHtml(m.display_name)}</option>`))
        .join("");
      return `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(lead ? lead.display_name : "未指定")}</td><td>${escapeHtml(row.status)}</td><td>${new Date(row.created_at).toLocaleDateString("zh-CN")}</td><td><form method="post" action="/admin/teams/lead" style="display:flex;gap:4px"><input type="hidden" name="teamId" value="${escapeHtml(row.id)}"><select name="memberId">${options}</select><button type="submit">保存负责人</button></form><form method="post" action="/admin/teams/update" style="display:flex;gap:4px;margin-top:4px"><input type="hidden" name="teamId" value="${escapeHtml(row.id)}"><input name="name" value="${escapeHtml(row.name)}" maxlength="80" required><select name="status"><option value="active"${row.status === "active" ? " selected" : ""}>启用</option><option value="disabled"${row.status === "disabled" ? " selected" : ""}>停用</option></select><button type="submit">保存团队</button></form></td></tr>`;
    }).join("");
    return reply.type("text/html").send(adminPage(
      "团队",
      `<div class="card"><h1>团队</h1><p><a href="/admin">返回总览</a> · <a href="/admin/teachers">导师</a></p>
       <form method="post" action="/admin/teams"><label>团队名称</label><input name="name" maxlength="80" required><p><button type="submit">添加团队</button></p></form>
       <table><tr><th>名称</th><th>负责人</th><th>状态</th><th>创建时间</th><th>操作</th></tr>${rows || "<tr><td colspan='5'>还没有团队。</td></tr>"}</table></div>`,
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

  app.post("/admin/teams/lead", async (request, reply) => {
    const admin = await requireAdmin(db, request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const teamId = typeof body.teamId === "string" ? body.teamId : "";
    const memberId = typeof body.memberId === "string" && body.memberId ? body.memberId : null;
    try {
      await assignTeamLead(db, admin, teamId, memberId);
    } catch (error) {
      return reply.code(400).type("text/html").send(adminPage("设置负责人失败", `<div class="card"><p class="error">${escapeHtml(error instanceof Error ? error.message : String(error))}</p></div>`, admin.username));
    }
    return reply.redirect("/admin/teams");
  });

  app.get("/admin/usage", async (request, reply) => {
    const admin = await requireAdmin(db, request);
    const rows = await db.query(
      `SELECT coalesce(m.team_name, '未分配团队') AS team_name,
              coalesce(m.display_name, '未知导师') AS teacher_name,
              count(u.id)::int AS calls,
              coalesce(sum(u.input_tokens + u.output_tokens), 0)::int AS tokens,
              coalesce(sum(u.estimated_cost_cny), 0)::numeric(12,4) AS cost
       FROM usage_events u
       LEFT JOIN members m ON m.id = u.member_id
       WHERE u.org_id = $1 AND u.created_at >= date_trunc('month', now())
       GROUP BY team_name, teacher_name
       ORDER BY cost DESC, team_name, teacher_name`,
      [admin.org.id],
    );
    const table = rows.rows.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.slug)}</td><td>${escapeHtml(row.status)}</td><td>${row.members}</td><td>${row.admins}</td><td>¥${row.monthly_budget_cny}</td><td><form method="post" action="/admin/tenants/switch" style="display:inline"><input type="hidden" name="orgId" value="${escapeHtml(row.id)}"><button type="submit">切换后台</button></form> <a href="/admin/tenants/${escapeHtml(row.id)}/admins">管理员</a></td></tr>`).join("");
    return reply.type("text/html").send(adminPage(
      "用量",
      `<div class="card"><h1>本月用量</h1><p><a href="/admin">返回总览</a> · <a href="/admin/settings">组织设置</a></p>
       <p class="muted">按团队和导师聚合；实际费用以 DeepSeek 账单为准。</p>
       <table><tr><th>团队</th><th>导师</th><th>调用次数</th><th>Token</th><th>估算费用</th></tr>${table || "<tr><td colspan='5'>本月还没有调用。</td></tr>"}</table></div>`,
      admin.username,
    ));
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
    const rows = teachers.rows.map((row) => `<tr><td>${escapeHtml(row.display_name)}</td><td>${escapeHtml(row.team_name ?? "—")}</td><td>${escapeHtml(row.role)}</td><td>${escapeHtml(row.status)}</td><td>${row.devices}</td><td><form method="post" action="/admin/teachers/update" style="display:flex;flex-wrap:wrap;gap:4px"><input type="hidden" name="memberId" value="${escapeHtml(row.id)}"><input name="name" value="${escapeHtml(row.display_name)}" maxlength="40" required><select name="teamId"><option value="">未分团队</option>${teamOptions}</select><select name="status"><option value="active"${row.status === "active" ? " selected" : ""}>启用</option><option value="disabled"${row.status === "disabled" ? " selected" : ""}>停用</option></select><button type="submit">保存</button></form><form method="post" action="/admin/teachers/revoke" style="margin-top:4px"><input type="hidden" name="memberId" value="${escapeHtml(row.id)}"><button type="submit">吊销设备</button></form></td></tr>`).join("");
    return reply.type("text/html").send(adminPage(
      "导师",
      `<div class="card"><h1>导师</h1><p><a href="/admin">返回总览</a> · <a href="/admin/teams">团队</a> · <a href="/admin/invites">邀请码</a></p>
       ${teamOptions ? `<form method="post" action="/admin/teachers"><label>导师姓名</label><input name="name" maxlength="40" required>
       <label>所属团队</label><select name="teamId" required>${teamOptions}</select>
       <label>角色</label><select name="role"><option value="teacher">导师</option><option value="mentor">导师</option></select>
       <p><button type="submit">创建导师</button></p></form>` : `<p class="muted">请先创建团队。</p>`}
       <table><tr><th>姓名</th><th>团队</th><th>角色</th><th>状态</th><th>设备</th><th>编辑/设备</th></tr>${rows || "<tr><td colspan='6'>还没有导师。</td></tr>"}</table></div>`,
      admin.username,
    ));
  });

  app.post("/admin/teachers", async (request, reply) => {
    const admin = await requireAdmin(db, request);
    const input = teacherSchema.safeParse(request.body ?? {});
    if (!input.success) return reply.code(400).type("text/html").send(adminPage("参数错误", `<div class="card"><p class="error">导师信息不合法。</p></div>`, admin.username));
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

  app.get("/admin/tenants", async (request, reply) => {
    const admin = await requirePlatformAdmin(db, request);
    const rows = await db.query(
      `SELECT o.id, o.name, o.slug, o.status, o.monthly_budget_cny,
              count(DISTINCT m.id)::int AS members,
              count(DISTINCT a.id)::int AS admins
       FROM organizations o
       LEFT JOIN members m ON m.org_id = o.id
       LEFT JOIN admin_users a ON a.org_id = o.id
       GROUP BY o.id ORDER BY o.created_at ASC`,
    );
    const table = rows.rows.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.slug)}</td><td>${escapeHtml(row.status)}</td><td>${row.members}</td><td>${row.admins}</td><td>¥${row.monthly_budget_cny}</td><td><form method="post" action="/admin/tenants/switch" style="display:inline"><input type="hidden" name="orgId" value="${escapeHtml(row.id)}"><button type="submit">切换后台</button></form> <a href="/admin/tenants/${escapeHtml(row.id)}/admins">管理员</a></td></tr>`).join("");
    return reply.type("text/html").send(adminPage(
      "组织",
      `<div class="card"><h1>组织</h1><p><a href="/admin">返回总览</a> · <form method="post" action="/admin/tenants/switch" style="display:inline"><input type="hidden" name="orgId" value=""><button type="submit">回到我的组织</button></form></p>
       <p class="muted">每个组织拥有独立团队、导师、框架、AI Key、预算和用量。组织之间不共享数据。</p>
       <form method="post" action="/admin/tenants">
         <label>组织名称</label><input name="name" maxlength="80" required>
         <label>组织管理员用户名</label><input name="adminUsername" maxlength="60" required>
         <label>初始密码（至少 12 位）</label><input name="adminPassword" type="password" minlength="12" required>
         <label>月度预算（元）</label><input name="monthlyBudgetCny" type="number" min="0" step="0.01" value="0">
         <p><button type="submit">创建组织与管理员</button></p>
       </form>
       <table><tr><th>名称</th><th>Slug</th><th>状态</th><th>导师</th><th>管理员</th><th>月预算</th><th>操作</th></tr>${table}</table></div>`,
      admin.username,
    ));
  });

  app.post("/admin/tenants", async (request, reply) => {
    const admin = await requirePlatformAdmin(db, request);
    const input = tenantSchema.safeParse(request.body ?? {});
    if (!input.success) return reply.code(400).type("text/html").send(adminPage("参数错误", `<div class="card"><p class="error">组织参数不合法。</p></div>`, admin.username));
    try {
      await createTenant(db, admin, input.data);
    } catch (error) {
      return reply.code(400).type("text/html").send(adminPage("创建组织失败", `<div class="card"><p class="error">${escapeHtml(error instanceof Error ? error.message : String(error))}</p></div>`, admin.username));
    }
    return reply.redirect("/admin/tenants");
  });

  app.post("/admin/tenants/switch", async (request, reply) => {
    const admin = await requirePlatformAdmin(db, request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const orgId = typeof body.orgId === "string" && body.orgId ? body.orgId : null;
    try {
      await switchAdminTenant(db, request.cookies?.la_admin ?? "", orgId);
    } catch (error) {
      return reply.code(400).type("text/html").send(adminPage("切换组织失败", `<div class="card"><p class="error">${escapeHtml(error instanceof Error ? error.message : String(error))}</p></div>`, admin.username));
    }
    return reply.redirect("/admin");
  });

  app.get("/admin/tenants/:tenantId/admins", async (request, reply) => {
    const admin = await requirePlatformAdmin(db, request);
    const tenantId = String((request.params as { tenantId?: string }).tenantId ?? "");
    const tenant = await db.query("SELECT id, name FROM organizations WHERE id = $1", [tenantId]);
    if (!tenant.rows[0]) return reply.code(404).type("text/html").send(adminPage("组织不存在", `<div class="card"><p class="error">组织不存在。</p></div>`, admin.username));
    const admins = await db.query(
      "SELECT id, username, status, created_at FROM admin_users WHERE org_id = $1 AND is_platform_admin = false ORDER BY created_at",
      [tenantId],
    );
    const rows = admins.rows.map((row) => `<tr><td>${escapeHtml(row.username)}</td><td>${escapeHtml(row.status)}</td><td>${new Date(row.created_at).toLocaleDateString("zh-CN")}</td><td>
      <form method="post" action="/admin/tenants/${escapeHtml(tenantId)}/admins/password" style="display:flex;gap:4px;flex-wrap:wrap">
        <input type="hidden" name="adminId" value="${escapeHtml(row.id)}"><input type="password" name="password" minlength="12" placeholder="新密码至少12位" required><button type="submit">重置密码</button>
      </form>
      <form method="post" action="/admin/tenants/${escapeHtml(tenantId)}/admins/status"><input type="hidden" name="adminId" value="${escapeHtml(row.id)}"><input type="hidden" name="status" value="${row.status === "active" ? "disabled" : "active"}"><button type="submit">${row.status === "active" ? "停用" : "启用"}</button></form>
    </td></tr>`).join("");
    return reply.type("text/html").send(adminPage(
      "组织管理员",
      `<div class="card"><h1>${escapeHtml(tenant.rows[0].name)} · 管理员</h1><p><a href="/admin/tenants">返回组织</a></p>
       <form method="post" action="/admin/tenants/${escapeHtml(tenantId)}/admins"><label>新管理员用户名</label><input name="username" maxlength="60" required><label>初始密码（至少12位）</label><input type="password" name="password" minlength="12" required><p><button type="submit">创建管理员</button></p></form>
       <table><tr><th>用户名</th><th>状态</th><th>创建时间</th><th>操作</th></tr>${rows || "<tr><td colspan='4'>还没有组织管理员。</td></tr>"}</table></div>`,
      admin.username,
    ));
  });

  app.post("/admin/tenants/:tenantId/admins", async (request, reply) => {
    const admin = await requirePlatformAdmin(db, request);
    const tenantId = String((request.params as { tenantId?: string }).tenantId ?? "");
    const body = (request.body ?? {}) as Record<string, unknown>;
    try {
      await createTenantAdmin(db, admin, { tenantId, username: String(body.username ?? ""), password: String(body.password ?? "") });
    } catch (error) {
      return reply.code(400).type("text/html").send(adminPage("创建管理员失败", `<div class="card"><p class="error">${escapeHtml(error instanceof Error ? error.message : String(error))}</p></div>`, admin.username));
    }
    return reply.redirect(`/admin/tenants/${tenantId}/admins`);
  });

  app.post("/admin/tenants/:tenantId/admins/password", async (request, reply) => {
    const admin = await requirePlatformAdmin(db, request);
    const tenantId = String((request.params as { tenantId?: string }).tenantId ?? "");
    const body = (request.body ?? {}) as Record<string, unknown>;
    try {
      await resetTenantAdminPassword(db, admin, tenantId, String(body.adminId ?? ""), String(body.password ?? ""));
    } catch (error) {
      return reply.code(400).type("text/html").send(adminPage("重置密码失败", `<div class="card"><p class="error">${escapeHtml(error instanceof Error ? error.message : String(error))}</p></div>`, admin.username));
    }
    return reply.redirect(`/admin/tenants/${tenantId}/admins`);
  });

  app.post("/admin/tenants/:tenantId/admins/status", async (request, reply) => {
    const admin = await requirePlatformAdmin(db, request);
    const tenantId = String((request.params as { tenantId?: string }).tenantId ?? "");
    const body = (request.body ?? {}) as Record<string, unknown>;
    try {
      await setTenantAdminStatus(db, admin, tenantId, String(body.adminId ?? ""), body.status === "active" ? "active" : "disabled");
    } catch (error) {
      return reply.code(400).type("text/html").send(adminPage("更新管理员失败", `<div class="card"><p class="error">${escapeHtml(error instanceof Error ? error.message : String(error))}</p></div>`, admin.username));
    }
    return reply.redirect(`/admin/tenants/${tenantId}/admins`);
  });

  app.post("/admin/teams/update", async (request, reply) => {
    const admin = await requireAdmin(db, request);
    const input = teamUpdateSchema.safeParse(request.body ?? {});
    if (!input.success) return reply.code(400).type("text/html").send(adminPage("参数错误", `<div class="card"><p class="error">团队参数不合法。</p></div>`, admin.username));
    try {
      await updateTeam(db, admin, input.data.teamId, { name: input.data.name, status: input.data.status });
    } catch (error) {
      return reply.code(400).type("text/html").send(adminPage("更新团队失败", `<div class="card"><p class="error">${escapeHtml(error instanceof Error ? error.message : String(error))}</p></div>`, admin.username));
    }
    return reply.redirect("/admin/teams");
  });

  app.post("/admin/teachers/update", async (request, reply) => {
    const admin = await requireAdmin(db, request);
    const input = teacherUpdateSchema.safeParse(request.body ?? {});
    if (!input.success) return reply.code(400).type("text/html").send(adminPage("参数错误", `<div class="card"><p class="error">导师参数不合法。</p></div>`, admin.username));
    try {
      await updateTeacher(db, admin, input.data.memberId, {
        name: input.data.name,
        status: input.data.status,
        teamId: input.data.teamId || "",
      });
    } catch (error) {
      return reply.code(400).type("text/html").send(adminPage("更新导师失败", `<div class="card"><p class="error">${escapeHtml(error instanceof Error ? error.message : String(error))}</p></div>`, admin.username));
    }
    return reply.redirect("/admin/teachers");
  });

  app.post("/admin/teachers/revoke", async (request, reply) => {
    const admin = await requireAdmin(db, request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    try {
      await revokeMemberDevices(db, admin, String(body.memberId ?? ""));
    } catch (error) {
      return reply.code(400).type("text/html").send(adminPage("吊销设备失败", `<div class="card"><p class="error">${escapeHtml(error instanceof Error ? error.message : String(error))}</p></div>`, admin.username));
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
    "邀请导师",
    `<div class="card">
      <h1>邀请导师</h1>
      <p><a href="/admin">返回总览</a> · <a href="/admin/teachers">导师</a> · <a href="/admin/teams">团队</a></p>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
      ${code ? `<p class="ok">邀请码：<b style="font-size:22px;letter-spacing:.12em">${escapeHtml(code)}</b><br><span class="muted">${escapeHtml(teacherName)} · ${escapeHtml(teamName)} · 有效期至 ${escapeHtml(expiresAt?.toLocaleString("zh-CN"))}；仅可使用一次。</span></p>` : ""}
      ${teacherOptions ? `<form method="post" action="/admin/invites">
        <label>导师</label><select name="teacherId" required>${teacherOptions}</select>
        <label>所属团队</label><select name="teamId" required>${teamOptions}</select>
        <label>有效期（小时）</label><input type="number" name="expiresInHours" value="168" min="1" max="720">
        <label>最多使用次数</label><input type="number" name="maxUses" value="1" min="1" max="100">
        <p><button type="submit">生成邀请码</button></p>
      </form>` : `<p class="muted">请先在「导师」页创建导师。</p>`}
      <p class="muted">邀请码绑定导师姓名和团队；导师在 Obsidian 插件中只需输入邀请码和设备名，姓名/团队由服务端返回。</p>
    </div>`,
    admin.username,
  );
}
