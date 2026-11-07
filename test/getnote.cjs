/**
 * 得到大脑 OpenAPI 客户端测试：mock requestUrl，验证路径、查询参数、鉴权头与响应解析。
 * 运行：node test/getnote.cjs
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const ts = require("typescript");
const Module = require("module");

const root = path.join(__dirname, "..");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "literacy-getnote-test-"));
for (const file of ["types.ts", "getnote.ts"]) {
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

const calls = [];
const stub = {
  requestUrl: async (request) => {
    calls.push(request);
    const url = new URL(request.url);
    if (request.headers?.Authorization === "Bearer bad") {
      return { status: 401, text: JSON.stringify({ success: false, error: { message: "bad key" } }) };
    }
    if (url.pathname.endsWith("/resource/note/list")) {
      return {
        status: 200,
        text: JSON.stringify({
          success: true,
          data: {
            notes: [
              {
                id: "note_1",
                title: "社区小店调研",
                note_type: "class_audio",
                source: "getseed",
                created_at: "2026-11-06T10:15:00+08:00",
                updated_at: "2026-11-06T11:40:00+08:00",
              },
              {
                id: 1926247581554458520,
                note_id: "1926247581554458520",
                title: "大整数 ID 笔记",
                note_type: "recorder_audio",
                source: "getseed",
                created_at: "2026-11-06T12:15:00+08:00",
                updated_at: "2026-11-06T13:40:00+08:00",
              },
            ],
            pagination: { has_more: false, next_cursor: null },
          },
        }),
      };
    }
    if (url.pathname.endsWith("/resource/note/detail")) {
      return {
        status: 200,
        text: JSON.stringify({
          success: true,
          data: {
            note: {
              id: url.searchParams.get("id"),
              title: "社区小店调研",
              note_type: "class_audio",
              source: "getseed",
              created_at: "2026-11-06T10:15:00+08:00",
              updated_at: "2026-11-06T11:40:00+08:00",
              audio: { original: "张三说这家店帮邻居省时间。", duration: 3600, play_url: "https://example.com/a.mp3" },
            },
          },
        }),
      };
    }
    return { status: 404, text: "not found" };
  },
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "obsidian") return stub;
  return originalLoad.call(this, request, parent, isMain);
};

const { listGetnoteNotes, getGetnoteNote } = require(path.join(outDir, "getnote.js"));

const settings = {
  getnoteApiBase: "https://openapi.biji.com/open/api/v1",
  getnoteApiKey: "gk_test",
  getnoteClientId: "cli_test",
  getnoteSource: "getseed",
};

(async () => {
  const notes = await listGetnoteNotes(settings, {
    createdFrom: "2026-11-01T00:00:00.000Z",
    createdTo: "2026-11-07T00:00:00.000Z",
    pageSize: 50,
  });
  assert.equal(notes.length, 2);
  assert.equal(notes[0].id, "note_1");
  assert.equal(notes[1].id, "1926247581554458520", "超过安全整数的 note_id 不能丢精度");

  const listCall = calls[0];
  assert.equal(listCall.headers.Authorization, "Bearer gk_test");
  assert.equal(listCall.headers["X-Client-ID"], "cli_test");
  const listUrl = new URL(listCall.url);
  assert.equal(listUrl.searchParams.get("source"), "getseed");
  assert.equal(listUrl.searchParams.get("page_size"), "50");
  assert.equal(listUrl.searchParams.get("created_from"), "2026-11-01T00:00:00.000Z");
  console.log("  ok   列表路径/查询参数/鉴权头");

  const detail = await getGetnoteNote(settings, "note_1");
  assert.equal(detail.id, "note_1");
  assert.equal(detail.audio.duration, 3600);
  assert.ok(detail.audio.original.includes("张三"));
  const bigDetail = await getGetnoteNote(settings, notes[1].id);
  assert.equal(bigDetail.id, "1926247581554458520");
  console.log("  ok   详情转写解析");

  let failed = false;
  try {
    await listGetnoteNotes({ ...settings, getnoteApiKey: "bad" }, {
      createdFrom: "2026-11-01T00:00:00.000Z",
      createdTo: "2026-11-07T00:00:00.000Z",
    });
  } catch (error) {
    failed = /鉴权失败/.test(String(error && error.message));
  }
  assert.ok(failed, "401 应转为友好错误");
  console.log("  ok   401 鉴权错误提示");

  fs.rmSync(outDir, { recursive: true, force: true });
  console.log("得到 OpenAPI 客户端测试通过。");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
