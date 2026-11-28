import { normalizePath, type App } from "obsidian";
import type { AssessmentSettings } from "./types";
import { ensureFolder, writeText } from "./vault";

export const MENTOR_PROFILE_FILENAME = "导师信息.md";

export function mentorProfilePath(settings: AssessmentSettings): string {
  return normalizePath(`${settings.dataRoot}/00_框架/${MENTOR_PROFILE_FILENAME}`);
}

function yamlValue(value: string): string {
  return JSON.stringify(value);
}

/**
 * Record the joined organization/team/mentor in the framework folder.
 * The mentor shouldn't need to see internal framework source folders; this one
 * plain note is the visible, human-readable identity record.
 */
export async function writeMentorProfile(app: App, settings: AssessmentSettings): Promise<void> {
  if (!settings.orgName.trim()) return;
  const path = mentorProfilePath(settings);
  await ensureFolder(app, path.slice(0, path.lastIndexOf("/")));
  const lines = [
    "---",
    "type: literacy-mentor-profile",
    `organization: ${yamlValue(settings.orgName)}`,
    `organization_id: ${yamlValue(settings.orgId)}`,
    `team: ${yamlValue(settings.orgTeamName)}`,
    `mentor: ${yamlValue(settings.orgMemberName)}`,
    `member_id: ${yamlValue(settings.orgMemberId)}`,
    `updated: ${yamlValue(new Date().toISOString())}`,
    "---",
    "",
    "# 导师信息",
    "",
    `- 组织：${settings.orgName || "未加入"}`,
    `- 团队：${settings.orgTeamName || "未分配"}`,
    `- 导师：${settings.orgMemberName || "未命名"}`,
    "",
    "> 此文件由素养教师工作台在加入/刷新组织时自动更新。",
    "> 组织、团队、导师身份由管理端预建并绑定邀请码，插件端只读。",
    "",
  ];
  await writeText(app, path, lines.join("\n"));
}
