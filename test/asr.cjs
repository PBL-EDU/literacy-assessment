/**
 * 语音转写传输层测试：启动本地 HTTP 服务，验证 multipart、中文文件名与 25 MB 保护。
 * 运行：node test/asr.cjs
 */
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "literacy-asr-test-"));
for (const file of ["types.ts", "core.ts", "asr.ts"]) {
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

const { transcribeFile } = require(path.join(outDir, "asr.js"));

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "literacy-asr-files-"));
const audioPath = path.join(workDir, "中文录音.mp3");
fs.writeFileSync(audioPath, Buffer.from("ID3fake-audio-bytes"));

let captured = null;
const server = http.createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    captured = Buffer.concat(chunks);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        text: "测试转写",
        language: "zh",
        duration: 2.5,
        segments: [{ start: 0, end: 2.5, text: "测试转写" }],
      }),
    );
  });
});

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

(async () => {
  const port = await listen(server);
  const settings = {
    asrEnabled: true,
    asrBaseUrl: `http://127.0.0.1:${port}/v1`,
    asrApiKey: "test-key",
    asrModel: "whisper-1",
    asrLanguage: "zh",
    aiTimeoutMs: 30_000,
  };

  const result = await transcribeFile(settings, audioPath, "中文录音.mp3");
  assert.equal(result.text, "测试转写");
  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].text, "测试转写");
  assert.equal(result.model, "whisper-1");
  console.log("  ok   multipart 转写请求与响应解析");

  const bodyText = captured.toString("utf8");
  assert.ok(bodyText.includes('name="model"'), "缺 model 字段");
  assert.ok(bodyText.includes("whisper-1"), "缺模型值");
  assert.ok(bodyText.includes('filename="'), "缺 filename");
  assert.ok(!/[^\x00-\x7F]/.test(bodyText.match(/filename="([^"]+)"/)[1]), "filename 必须是 ASCII 兜底");
  console.log("  ok   中文文件名已转 ASCII，不会触发 HTTP header 错误");

  // 25 MB 保护：OpenAI 官方地址 + 超大文件，应在发请求前报错
  const bigPath = path.join(workDir, "big.mp3");
  fs.writeFileSync(bigPath, Buffer.alloc(26 * 1024 * 1024));
  const openAiSettings = { ...settings, asrBaseUrl: "https://api.openai.com/v1" };
  let blocked = false;
  try {
    await transcribeFile(openAiSettings, bigPath, "big.mp3");
  } catch (error) {
    blocked = /25 MB/.test(String(error && error.message));
  }
  assert.ok(blocked, "26 MB 文件应在本地被 25 MB 规则挡住");
  console.log("  ok   OpenAI 25 MB 上限在本地提前拦截");

  server.close();
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.rmSync(outDir, { recursive: true, force: true });
  console.log("ASR 测试通过。");
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
