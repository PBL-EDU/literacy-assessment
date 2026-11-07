/**
 * 冒烟测试：用 mock 的 obsidian 模块加载构建产物，确认没有顶层运行时错误。
 * 运行：node test/smoke.cjs（需要先 npm run build）
 */
const assert = require("assert");
const Module = require("module");
const path = require("path");

const originalLoad = Module._load;
const obsidianStub = {
  Plugin: class {},
  ItemView: class {},
  Modal: class {},
  PluginSettingTab: class {},
  Setting: class {},
  Notice: class {},
  TFile: class {},
  TFolder: class {},
  WorkspaceLeaf: class {},
  FileSystemAdapter: class {},
  MarkdownView: class {},
  Menu: class {},
  normalizePath: (value) => value,
  requestUrl: async () => ({ status: 200, text: "{}" }),
  parseYaml: () => ({}),
};

Module._load = function load(request, parent, isMain) {
  if (request === "obsidian") return obsidianStub;
  return originalLoad.call(this, request, parent, isMain);
};

const bundle = path.join(__dirname, "..", "main.js");
const loaded = require(bundle);
assert.ok(loaded && loaded.default, "main.js 应该有 default export");
assert.equal(typeof loaded.default, "function", "default export 应该是插件类");
console.log("  ok   main.js 加载成功，default export 是类");
