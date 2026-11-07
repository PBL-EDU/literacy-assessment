/**
 * 纯逻辑单元测试（不启动 Obsidian）。
 * 运行：node test/run.cjs
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "literacy-assessment-test-"));
process.on("exit", () => {
  try {
    fs.rmSync(outDir, { recursive: true, force: true });
  } catch {
    /* 临时目录清理失败不影响测试结果 */
  }
});

for (const file of ["types.ts", "core.ts", "prompt.ts", "report.ts"]) {
  const source = fs.readFileSync(path.join(root, "src", file), "utf8");
  const out = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2018,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
    },
  }).outputText;
  fs.writeFileSync(path.join(outDir, file.replace(/\.ts$/, ".js")), out);
}

const core = require(path.join(outDir, "core.js"));
const prompt = require(path.join(outDir, "prompt.js"));
const report = require(path.join(outDir, "report.js"));

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  FAIL ${name}`);
    console.log(`       ${error && error.message}`);
  }
}

function expect(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label || "值"} 不匹配\n  实际: ${a}\n  期望: ${b}`);
}

function ok(value, label) {
  if (!value) throw new Error(label || "断言失败");
}

/* ---------------- 路径与分类 ---------------- */

test("sanitizeName 去掉非法字符并保留中文", () => {
  const name = core.sanitizeName('a/b:c*d?"e<f>g|h#i^j[k]');
  ok(!/[\\/:*?"<>|#^[\]]/.test(name), `仍含非法字符: ${name}`);
  expect(core.sanitizeName("  "), "未命名");
  expect(core.sanitizeName("职业探索课"), "职业探索课");
});

test("activityNotePath 用行动名称作为文件名", () => {
  expect(core.activityNotePath("白日梦行动/01_系列/项目/行动/2026-11-06_调研", "社区调研"), "白日梦行动/01_系列/项目/行动/2026-11-06_调研/社区调研.md");
  expect(core.activityNotePath("白日梦行动/01_系列/项目/行动/2026-11-06_调研"), "白日梦行动/01_系列/项目/行动/2026-11-06_调研/行动.md");
});

test("行动报告标题和文件名包含项目 · 行动", () => {
  const meta = core.normalizeActivityMeta(
    { title: "社区小店调研", series: "社区小店调研项目" },
    "2026-11-06_社区小店调研",
  );
  expect(core.activityReportTitle(meta), "行动成长报告（社区小店调研项目 · 社区小店调研）");
  expect(core.activityReportFileName(meta), "行动成长报告（社区小店调研项目 · 社区小店调研）.md");
});

test("renderOverviewReport R1 版式", () => {
  const overview = core.normalizeOverviewAssessment(
    {
      overview: "项目整体稳步推进。",
      highlights: ["两位同学开始主动承担角色。"],
      goal_progress: [{ goal: "协作", level: "L5", evidence_summary: "多次分工", trend: "进步" }],
      students: [
        { student: "张三", summary: "从等待分工到主动协调。", highlights: ["主动协调"], evidence: [] },
      ],
      suggestions: ["继续做真实项目"],
      missing_evidence: ["缺家庭场景"],
      evidence_photos: ["白日梦行动/素材/a.jpg"],
    },
    "project_overview",
    "社区小店调研项目",
    "2026 秋",
    "test-model",
    ["张三"],
    2,
  );
  const md = report.renderOverviewReport(overview);
  ok(md.includes("# 项目总报告（社区小店调研项目）"), "缺项目总报告标题");
  ok(md.includes("> [!summary]"), "缺摘要 callout");
  ok(md.includes("## 四、同学成长"), "缺同学成长");
  ok(md.includes("![[白日梦行动/素材/a.jpg]]"), "缺证据照片");
});

test("seriesRoots 同时支持 01_项目 与旧 01_系列", () => {
  expect(core.seriesRoots({ dataRoot: "白日梦行动" }), [
    "白日梦行动/01_项目",
    "白日梦行动/01_系列",
  ]);
});

test("activityFolderName 用日期前缀", () => {
  expect(core.activityFolderName("2026-11-06", "社区小店调研"), "2026-11-06_社区小店调研");
});

test("classifyFile 分类", () => {
  expect(core.classifyFile("a.m4a"), "audio");
  expect(core.classifyFile("a.MP4"), "video");
  expect(core.classifyFile("a.JPG"), "image");
  expect(core.classifyFile("a.md"), "text");
  expect(core.classifyFile("a.pdf"), "document");
  expect(core.classifyFile("a.zip"), "other");
});

test("formatTimestamp", () => {
  expect(core.formatTimestamp(0), "00:00:00");
  expect(core.formatTimestamp(750), "00:12:30");
  expect(core.formatTimestamp(3661), "01:01:01");
});

/* ---------------- 解析 ---------------- */

test("extractJson 支持代码围栏与嵌套", () => {
  expect(core.extractJson('```json\n{"a":1}\n```'), { a: 1 });
  expect(core.extractJson('说明：{"a":{"b":2},"c":"}"} 完毕'), { a: { b: 2 }, c: "}" });
  expect(core.extractJson("完全不是 JSON"), null);
});

test("splitFrontmatter", () => {
  const parsed = core.splitFrontmatter("---\ntitle: 测试\n---\n\n正文");
  expect(parsed.frontmatter, "title: 测试");
  expect(parsed.body.replace(/\r/g, ""), "\n正文");
});

test("parseParticipants / parseGoals", () => {
  expect(core.parseParticipants("张三、李四\n王五, 张三"), ["张三", "李四", "王五"]);
  expect(core.parseGoals("1. 能说出价值\n2. 能完成分工；能复盘"), ["能说出价值", "能完成分工", "能复盘"]);
});

/* ---------------- 上下文预算 ---------------- */

test("buildContext 按优先级并截断", () => {
  const blocks = [
    { label: "低优先", text: "L".repeat(100), priority: 9 },
    { label: "高优先", text: "H".repeat(100), priority: 1 },
  ];
  const built = core.buildContext(blocks, 150);
  ok(built.text.indexOf("高优先") < built.text.indexOf("低优先"), "高优先应排在前面");
  ok(built.text.length <= 150, `上下文超限: ${built.text.length}`);
  ok(built.truncated, "应有截断标记");
  ok(built.text.includes("中间省略"), "应包含省略标记");
});

/* ---------------- 归一化 ---------------- */

test("normalizeActivityAssessment 补齐参与者并限制置信度", () => {
  const meta = {
    action_id: "act_1",
    title: "测试活动",
    type: "课堂",
    date: "2026-11-06",
    mentor: "李老师",
    participants: ["张三", "李四"],
    goals: ["能完成分工"],
    framework: "",
    status: "收集中",
  };
  const raw = {
    overview: "整体",
    goal_analysis: [{ goal: "能完成分工", coverage: "部分", comment: "有证据" }],
    students: [
      {
        student: "张三",
        summary: "具体表现",
        evidence: [
          {
            goal: "能完成分工",
            dimension: "CCD.3",
            level: "l4",
            quote: "我来做记录",
            source: "转写/a.md @ 00:01:00",
            confidence: 2,
            origin: "推断",
          },
        ],
      },
    ],
  };
  const normalized = core.normalizeActivityAssessment(raw, meta, "test-model");
  expect(normalized.students.length, 2);
  const zhang = normalized.students.find((s) => s.student === "张三");
  ok(zhang, "应有张三");
  expect(zhang.evidence.length, 1);
  expect(zhang.evidence[0].level, "L4");
  expect(zhang.evidence[0].confidence, 1);
  expect(zhang.evidence[0].origin, "推断");
  const li = normalized.students.find((s) => s.student === "李四");
  ok(li, "应补齐李四");
  expect(li.evidence.length, 0);
  ok(li.missing_evidence.length > 0, "李四应有待补证据");
});

test("normalizeActivityMeta 支持时间与系列字段", () => {
  const meta = core.normalizeActivityMeta(
    {
      title: "第二次课",
      type: "课程",
      date: "2026-11-06",
      start_time: "10:00",
      end_time: "11:30",
      series: "社区小店项目",
      sequence: 2,
      groups: ["A组"],
      getnote_ids: ["note_1"],
    },
    "2026-11-06_第二次课",
  );
  expect(meta.type, "课程");
  expect(meta.start_time, "10:00");
  expect(meta.series, "社区小店项目");
  expect(meta.sequence, 2);
  expect(meta.groups, ["A组"]);
  expect(meta.getnote_ids, ["note_1"]);
  ok(meta.series_id.startsWith("series_"), "应生成 series_id");
});

test("matchNoteToActions 按时间与学员命中", () => {
  const action = core.normalizeActivityMeta(
    {
      title: "社区小店调研",
      type: "课堂",
      date: "2026-11-06",
      start_time: "10:00",
      end_time: "11:30",
      participants: ["张三", "李四"],
      goals: ["能说出小店为谁提供了什么价值"],
    },
    "2026-11-06_社区小店调研",
  );
  const matches = core.matchNoteToActions(
    {
      title: "社区小店调研 课堂录音",
      transcript: "张三说这家店帮邻居省时间，李四问店主为什么不去超市。",
      createdAt: "2026-11-06T10:15:00",
      durationSec: 3600,
    },
    [action],
    { windowHours: 6 },
  );
  expect(matches.length, 1);
  ok(matches[0].score >= 6, `匹配分数过低: ${matches[0].score}`);
  ok(core.decideActionMatch(matches).confident, "应判定为可靠匹配");
});

test("matchNoteToActions 按系列名部分命中", () => {
  const action = core.normalizeActivityMeta(
    {
      title: "青少年概念图项目 设计讨论",
      type: "课堂",
      date: "2026-11-07",
      series: "青少年概念图项目",
      participants: ["沈达"],
      goals: [],
    },
    "2026-11-07_青少年概念图项目 设计讨论",
  );
  const matches = core.matchNoteToActions(
    {
      title: "概念图项目商讨--沈达＆石头1",
      transcript: "沈达和石头讨论概念图项目的设计。",
      createdAt: "2026-11-03T19:41:56",
      durationSec: 1800,
    },
    [action],
    { windowHours: 6 },
  );
  expect(matches.length, 1);
  ok(matches[0].score >= 6, `系列名部分命中分数过低: ${matches[0].score}`);
  ok(matches[0].reasons.some((reason) => reason.includes("系列名")), "应记录系列名命中");
});

test("groupActionsBySeries 按系列分组", () => {
  const a = core.normalizeActivityMeta({ title: "第一次", date: "2026-11-01", series: "项目A" }, "a");
  const b = core.normalizeActivityMeta({ title: "第二次", date: "2026-11-02", series: "项目A" }, "b");
  const c = core.normalizeActivityMeta({ title: "独立", date: "2026-11-03" }, "c");
  const groups = core.groupActionsBySeries([a, b, c]);
  expect(groups.length, 1);
  expect(groups[0].name, "项目A");
  expect(groups[0].actions.length, 2);
});

test("normalizeSeriesMeta / normalizeGroupMeta", () => {
  const series = core.normalizeSeriesMeta(
    { title: "项目A", series_type: "课程", goals: ["目标1"], mentor: "李老师" },
    "项目A",
  );
  expect(series.title, "项目A");
  expect(series.type, "课程");
  expect(series.goals, ["目标1"]);
  const group = core.normalizeGroupMeta(
    { name: "A组", members: ["张三", "李四"], series: "项目A" },
    "A组",
  );
  expect(group.name, "A组");
  expect(group.members, ["张三", "李四"]);
  ok(group.group_id.startsWith("group_"), "应生成 group_id");
});

test("renderActivityReport 带证据照片", () => {
  const assessment = sampleAssessment();
  assessment.students[0].evidence[0].photo = "白日梦行动/素材/课堂.jpg";
  assessment.evidence_photos = ["白日梦行动/素材/课堂.jpg"];
  const md = report.renderActivityReport(assessment);
  ok(md.includes("![[白日梦行动/素材/课堂.jpg]]"), "缺证据照片嵌入");
  ok(md.includes("## 附：证据照片"), "缺照片附件区");
});

test("normalizeStageAssessment", () => {
  const stage = core.normalizeStageAssessment(
    {
      overview: "阶段",
      goal_progress: [{ goal: "CCD.3", level: "L5", evidence_summary: "多次协作", trend: "进步" }],
      evidence: [{ quote: "我来协调", source: "活动A @ 00:02:00", confidence: 1.5 }],
      strengths: ["主动协调"],
    },
    "张三",
    "2026 秋",
    "test-model",
  );
  expect(stage.student, "张三");
  expect(stage.goal_progress[0].level, "L5");
  expect(stage.evidence[0].confidence, 1);
});

/* ---------------- 报告渲染 ---------------- */

function sampleAssessment() {
  return core.normalizeActivityAssessment(
    {
      overview: "孩子们完成了小店调研。",
      goal_analysis: [{ goal: "能说出价值", coverage: "部分", comment: "两名同学说出了受益者" }],
      students: [
        {
          student: "张三",
          summary: "主动承担记录。",
          evidence: [
            {
              goal: "能说出价值",
              dimension: "CCD.1",
              level: "L3",
              quote: "这家店帮邻居修东西",
              source: "转写/课堂.m4a.md @ 00:05:00",
              confidence: 0.8,
              origin: "原文",
            },
          ],
          strengths: ["能举具体例子"],
          next_steps: ["下一次让他采访一位顾客"],
          missing_evidence: ["还缺他自己的复盘"],
        },
      ],
      mentor_suggestions: ["下次提前分组"],
      missing_evidence: ["缺学习单照片"],
    },
    {
      action_id: "act_1",
      title: "社区小店调研",
      type: "课堂",
      date: "2026-11-06",
      mentor: "李老师",
      participants: ["张三"],
      goals: ["能说出价值"],
      framework: "",
      status: "收集中",
    },
    "test-model",
  );
}

test("renderActivityReport 包含关键区块与证据", () => {
  const md = report.renderActivityReport(sampleAssessment());
  ok(md.includes("# 行动成长报告（社区小店调研）"), "缺标题");
  ok(md.includes("## 一、行动概览"), "缺概览");
  ok(md.includes("## 三、学员观察"), "缺学员观察");
  ok(md.includes("这家店帮邻居修东西"), "缺证据引文");
  ok(md.includes("00:05:00"), "缺时间戳");
  ok(md.includes("没有证据的地方写「未观察到」") || md.includes("未观察到"), "缺免责声明");
  ok(md.includes("type: activity-report"), "缺 frontmatter");
});

test("renderStageReport 包含目标进展", () => {
  const stage = core.normalizeStageAssessment(
    {
      overview: "阶段概述",
      goal_progress: [{ goal: "CCD.3", level: "L5", evidence_summary: "多次协作", trend: "进步" }],
      evidence: [{ quote: "我来协调", source: "活动A @ 00:02:00", confidence: 1 }],
      strengths: ["主动协调"],
      suggestions: ["继续做项目"],
      missing_evidence: ["缺家庭场景"],
    },
    "张三",
    "2026 秋",
    "test-model",
  );
  const md = report.renderStageReport(stage);
  ok(md.includes("# 阶段性成长报告（2026 秋 · 张三）"), "缺标题");
  ok(md.includes("## 二、素养目标进展"), "缺目标进展");
  ok(md.includes("CCD.3"), "缺目标");
  ok(md.includes("进步"), "缺趋势");
});

test("renderStageReport 支持项目报告标题", () => {
  const stage = core.normalizeStageAssessment(
    {
      overview: "系列概述",
      goal_progress: [{ goal: "CCD.3", level: "L5", evidence_summary: "多次协作", trend: "进步" }],
    },
    "张三",
    "社区小店项目",
    "test-model",
  );
  stage.report_kind = "series";
  stage.report_title = "项目成长报告";
  const md = report.renderStageReport(stage);
  ok(md.includes("# 项目成长报告（社区小店项目 · 张三）"), "缺项目标题");
  ok(md.includes("**项目**：社区小店项目"), "缺项目标签");
});

/* ---------------- 提示词 ---------------- */

test("buildActivityMessages 包含目标、参与者与 JSON 要求", () => {
  const messages = prompt.buildActivityMessages({
    meta: {
      action_id: "act_1",
      title: "测试活动",
      type: "课堂",
      date: "2026-11-06",
      mentor: "李老师",
      participants: ["张三"],
      goals: ["能完成分工"],
      framework: "",
      status: "收集中",
    },
    framework: "CCD.3 与他人协作",
    context: "--- 来源：观察/a.md ---\n张三主动分工。",
    contextTruncated: false,
    photos: ["白日梦行动/素材/课堂.jpg"],
  });
  const all = messages.map((m) => m.content).join("\n");
  ok(all.includes("能完成分工"), "缺目标");
  ok(all.includes("张三"), "缺参与者");
  ok(all.includes("JSON"), "缺 JSON 要求");
  ok(all.includes("未观察到"), "缺未观察到规则");
  ok(all.includes("白日梦行动/素材/课堂.jpg"), "缺可用照片列表");
  ok(all.includes("photo"), "缺 photo 字段");
});

test("buildStageMessages 包含阶段与活动", () => {
  const messages = prompt.buildStageMessages({
    student: "张三",
    period: "2026 秋",
    framework: "CCD.3",
    context: "活动A 证据",
    activityTitles: ["活动A（2026-11-01）"],
  });
  const all = messages.map((m) => m.content).join("\n");
  ok(all.includes("张三"), "缺学员");
  ok(all.includes("2026 秋"), "缺阶段");
  ok(all.includes("活动A"), "缺活动");
});

/* ---------------- 结果 ---------------- */

console.log("");
console.log(`通过 ${passed} 项，失败 ${failures.length} 项。`);
if (failures.length) {
  process.exitCode = 1;
}
