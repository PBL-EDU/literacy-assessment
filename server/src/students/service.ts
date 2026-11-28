import { randomUUID } from "node:crypto";
import type { Db } from "../db/index.js";
import type { AuthContext } from "../auth/service.js";

export interface StudentLevelSnapshot {
  frameworkId?: string;
  frameworkName?: string;
  goal: string;
  level: string;
  updatedAt?: string;
}

export interface StudentSyncItem {
  name: string;
  currentLevels: StudentLevelSnapshot[];
  activityCount: number;
  evidenceCount: number;
  lastActivityAt?: string;
  summary: string;
}

export interface TeamStudentRow {
  id: string;
  name: string;
  teamId: string;
  teamName: string;
  memberId: string;
  memberName: string;
  currentLevels: StudentLevelSnapshot[];
  activityCount: number;
  evidenceCount: number;
  lastActivityAt: string | null;
  summary: string;
  updatedAt: string;
}

function cleanLevels(value: unknown): StudentLevelSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    return {
      frameworkId: typeof row.frameworkId === "string" ? row.frameworkId.slice(0, 120) : undefined,
      frameworkName: typeof row.frameworkName === "string" ? row.frameworkName.slice(0, 120) : undefined,
      goal: typeof row.goal === "string" ? row.goal.slice(0, 200) : "",
      level: typeof row.level === "string" ? row.level.slice(0, 40) : "",
      updatedAt: typeof row.updatedAt === "string" ? row.updatedAt.slice(0, 40) : undefined,
    };
  }).filter((item) => item.goal && item.level);
}

export async function syncStudentSummaries(
  db: Db,
  auth: AuthContext,
  input: unknown,
): Promise<{ synced: number; teamId: string }> {
  if (!auth.member.teamId) throw Object.assign(new Error("导师还没有所属团队，不能同步同学摘要"), { statusCode: 400 });
  const items = Array.isArray(input) ? input : [];
  if (!items.length) return { synced: 0, teamId: auth.member.teamId };
  if (items.length > 500) throw Object.assign(new Error("一次最多同步 500 名同学"), { statusCode: 400 });
  let synced = 0;
  for (const raw of items) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!name || name.length > 80) continue;
    const levels = cleanLevels(row.currentLevels);
    const activityCount = Math.max(0, Math.min(100000, Number(row.activityCount) || 0));
    const evidenceCount = Math.max(0, Math.min(100000, Number(row.evidenceCount) || 0));
    const lastActivityAt = typeof row.lastActivityAt === "string" && row.lastActivityAt ? row.lastActivityAt : null;
    const summary = typeof row.summary === "string" ? row.summary.slice(0, 1000) : "";
    const student = await db.query(
      `INSERT INTO students (id, org_id, team_id, name, status)
       VALUES ($1, $2, $3, $4, 'active')
       ON CONFLICT (org_id, team_id, name)
       DO UPDATE SET status = 'active', updated_at = now()
       RETURNING id`,
      [randomUUID(), auth.org.id, auth.member.teamId, name],
    );
    const studentId = String(student.rows[0].id);
    await db.query(
      `INSERT INTO student_summaries
       (student_id, member_id, current_levels, activity_count, evidence_count, last_activity_at, summary, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, now())
       ON CONFLICT (student_id, member_id)
       DO UPDATE SET current_levels = EXCLUDED.current_levels,
         activity_count = EXCLUDED.activity_count,
         evidence_count = EXCLUDED.evidence_count,
         last_activity_at = EXCLUDED.last_activity_at,
         summary = EXCLUDED.summary,
         updated_at = now()`,
      [studentId, auth.member.id, JSON.stringify(levels), activityCount, evidenceCount, lastActivityAt, summary],
    );
    synced += 1;
  }
  return { synced, teamId: auth.member.teamId };
}

export async function listTeamStudentSummaries(
  db: Db,
  orgId: string,
  teamId: string,
): Promise<TeamStudentRow[]> {
  const result = await db.query(
    `SELECT s.id, s.name, s.team_id, t.name AS team_name,
            sm.member_id, m.display_name, sm.current_levels,
            sm.activity_count, sm.evidence_count, sm.last_activity_at,
            sm.summary, sm.updated_at
     FROM students s
     JOIN teams t ON t.id = s.team_id
     JOIN student_summaries sm ON sm.student_id = s.id
     JOIN members m ON m.id = sm.member_id
     WHERE s.org_id = $1 AND s.team_id = $2 AND s.status = 'active'
     ORDER BY s.name, sm.updated_at DESC`,
    [orgId, teamId],
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    teamId: String(row.team_id),
    teamName: String(row.team_name),
    memberId: String(row.member_id),
    memberName: String(row.display_name),
    currentLevels: cleanLevels(row.current_levels),
    activityCount: Number(row.activity_count) || 0,
    evidenceCount: Number(row.evidence_count) || 0,
    lastActivityAt: row.last_activity_at ? new Date(String(row.last_activity_at)).toISOString() : null,
    summary: String(row.summary),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }));
}

export async function listOrgStudentSummaries(
  db: Db,
  orgId: string,
): Promise<TeamStudentRow[]> {
  const result = await db.query(
    `SELECT s.id, s.name, s.team_id, t.name AS team_name,
            sm.member_id, m.display_name, sm.current_levels,
            sm.activity_count, sm.evidence_count, sm.last_activity_at,
            sm.summary, sm.updated_at
     FROM students s
     LEFT JOIN teams t ON t.id = s.team_id
     JOIN student_summaries sm ON sm.student_id = s.id
     JOIN members m ON m.id = sm.member_id
     WHERE s.org_id = $1 AND s.status = 'active'
     ORDER BY t.name NULLS LAST, s.name, sm.updated_at DESC`,
    [orgId],
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    teamId: row.team_id ? String(row.team_id) : "",
    teamName: row.team_name ? String(row.team_name) : "未分团队",
    memberId: String(row.member_id),
    memberName: String(row.display_name),
    currentLevels: cleanLevels(row.current_levels),
    activityCount: Number(row.activity_count) || 0,
    evidenceCount: Number(row.evidence_count) || 0,
    lastActivityAt: row.last_activity_at ? new Date(String(row.last_activity_at)).toISOString() : null,
    summary: String(row.summary),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }));
}
