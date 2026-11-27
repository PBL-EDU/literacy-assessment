import test from "node:test";
import assert from "node:assert/strict";
import { parseFrameworkMarkdown } from "../src/frameworks/parser.js";

const sample = `---
framework_id: dream-default
name: 白日梦行动素养框架
version: "2026.1"
---

# 白日梦行动

| 路径 | 目标ID | 目标 | 维度 | L1 | L2 | L3 |
| --- | --- | --- | --- | --- | --- | --- |
| 自我认知/情绪理解/识别情绪 | SDU.1.1 | 能识别自己的情绪 | 自我认知 | 能说出 | 能识别 | 能解释 |
| 职业认知/职业角色/角色理解 | CCD.3.1 | 能说出不同职业角色 | 职业认知 | 能列举 | 能区分 | 能解释 |
`;

test("framework parser reads hierarchy, levels, and goal paths", () => {
  const parsed = parseFrameworkMarkdown(sample);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.frameworkId, "dream-default");
  assert.equal(parsed.version, "2026.1");
  assert.deepEqual(parsed.levels, ["L1", "L2", "L3"]);
  assert.equal(parsed.goals.length, 2);
  assert.deepEqual(parsed.goals[0].pathSegments, ["自我认知", "情绪理解", "识别情绪"]);
  assert.equal(parsed.goals[0].levels.L3, "能解释");
});

test("framework parser rejects duplicate goal ids and duplicate paths", () => {
  const duplicateId = sample.replace("CCD.3.1", "SDU.1.1");
  const parsed = parseFrameworkMarkdown(duplicateId);
  assert.ok(parsed.errors.some((error) => error.includes("目标 ID 重复")));
});

test("framework parser rejects empty path segments", () => {
  const badPath = sample.replace("自我认知/情绪理解/识别情绪", "自我认知//识别情绪");
  const parsed = parseFrameworkMarkdown(badPath);
  assert.ok(parsed.errors.some((error) => error.includes("路径为空")));
});

test("framework parser reports missing table", () => {
  const parsed = parseFrameworkMarkdown("# legacy\n\nno table");
  assert.ok(parsed.errors.length > 0);
});
