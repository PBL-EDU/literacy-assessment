import type { StudentTargetOverride, TargetRef } from "./types";

function yamlScalar(value: string): string {
  if (!value) return '""';
  if (/^[A-Za-z0-9_./-]+$/.test(value) && !/^(true|false|null|yes|no)$/i.test(value)) return value;
  return JSON.stringify(value);
}

export function targetYamlLines(target: TargetRef, indent = "  "): string[] {
  if (target.kind === "custom") {
    return [
      `${indent}- kind: custom`,
      `${indent}  id: ${yamlScalar(target.goalId || target.title)}`,
      `${indent}  title: ${yamlScalar(target.title)}`,
      ...(target.description ? [`${indent}  description: ${yamlScalar(target.description)}`] : []),
      ...(target.expectedLevelText
        ? [`${indent}  expectedLevelText: ${yamlScalar(target.expectedLevelText)}`]
        : []),
      ...(target.inheritedFrom ? [`${indent}  inheritedFrom: ${target.inheritedFrom}`] : []),
    ];
  }
  return [
    `${indent}- kind: framework`,
    `${indent}  source: ${target.source ?? "tenant"}`,
    `${indent}  frameworkId: ${yamlScalar(target.frameworkId)}`,
    `${indent}  frameworkName: ${yamlScalar(target.frameworkName)}`,
    `${indent}  frameworkVersion: ${yamlScalar(target.frameworkVersion)}`,
    `${indent}  goalId: ${yamlScalar(target.goalId)}`,
    `${indent}  path: ${yamlScalar(target.path)}`,
    `${indent}  title: ${yamlScalar(target.title)}`,
    ...(target.expectedLevel ? [`${indent}  expectedLevel: ${yamlScalar(target.expectedLevel)}`] : []),
    ...(target.inheritedFrom ? [`${indent}  inheritedFrom: ${target.inheritedFrom}`] : []),
  ];
}

export function studentTargetsYamlLines(
  values: Record<string, StudentTargetOverride[]> | undefined,
  indent = "  ",
): string[] {
  if (!values || !Object.keys(values).length) return [`${indent}[]`];
  const lines: string[] = [];
  for (const [student, rows] of Object.entries(values)) {
    lines.push(`${indent}${yamlScalar(student)}:`);
    for (const row of rows) {
      lines.push(`${indent}  - targetKey: ${yamlScalar(row.targetKey)}`);
      if (row.expectedLevel) lines.push(`${indent}    expectedLevel: ${yamlScalar(row.expectedLevel)}`);
      if (row.expectedLevelText) {
        lines.push(`${indent}    expectedLevelText: ${yamlScalar(row.expectedLevelText)}`);
      }
      if (row.reason) lines.push(`${indent}    reason: ${yamlScalar(row.reason)}`);
    }
  }
  return lines;
}

export function targetLabel(target: TargetRef): string {
  return target.kind === "custom" ? `其他：${target.title}` : `${target.goalId} ${target.title}`;
}
