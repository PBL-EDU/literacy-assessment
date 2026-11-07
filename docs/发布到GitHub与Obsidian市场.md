# 发布到 GitHub 与 Obsidian 社区市场

## 一、先做安全清理

公开发布前，以下目录/文件已被 `.gitignore` 排除，不要强行 `git add -f`：

- `demo-vault/`：含真实课堂素材、录音、学生姓名、报告和 API 配置；
- `docs/提示词/`：内部提示词资产；
- `docs/提示词系统与商业化.md`：内部讨论稿；
- `design/`：本地 UI 效果图和预览脚本；
- `dist/`：本地构建产物和 zip；
- `main.js`：由 CI 构建，不提交旧构建缓存；
- `test/integ-debug.cjs`：本地路径调试脚本。

确认：

```bash
git status --short
git ls-files | Select-String -Pattern "demo-vault|提示词|data.json|\.mp3"
```

第二条应无输出。若出现，先修正 `.gitignore` 或从暂存区移除。

## 二、发布前必须对齐的版本文件

| 文件 | 当前值 |
| --- | --- |
| `manifest.json` | `0.2.1` |
| `package.json` | `0.2.1` |
| `versions.json` | 含 `0.2.0`、`0.2.1` |
| `CHANGELOG.md` | 含 0.2.1 |
| `README.md` | 含安装、网络使用、许可说明 |

`versions.json` 格式：

```json
{
  "0.1.0": "1.4.0",
  "0.2.0": "1.4.0",
  "0.2.1": "1.4.0"
}
```

## 三、创建 GitHub 仓库并推送

### 网页建仓

1. 打开 <https://github.com/new>；
2. Owner 选 `PBL-EDU`（或你的个人账号）；
3. Repository name：`literacy-assessment`；
4. 选 **Public**；
5. **不要**勾选 “Add a README file”、“Add .gitignore”、“Choose a license”——本地已经有这些文件；
6. Create repository。

如果使用个人账号而不是 `PBL-EDU`，记得把 `manifest.json` 的 `authorUrl` 改成实际仓库地址。

### 推送

```bash
git remote add origin https://github.com/PBL-EDU/literacy-assessment.git
git push -u origin main
```

仓库必须是 **public**，Obsidian 审核需要访问源码。

## 四、创建 Release

Obsidian 要求：

- Release tag **必须等于** `manifest.json` 的 `version`，即 `0.2.1`，不要用 `v0.2.1`；
- Release 必须附带：
  - `main.js`
  - `manifest.json`
  - `styles.css`（可选，但本插件需要）

`docs/github-actions-release.yml` 是一份可选的 Release workflow 示例。当前仓库先用手动 Release，避免因 GitHub token 缺少 `workflow` scope 阻塞发布。

```bash
git tag 0.2.1
git push origin 0.2.1
```

然后在 GitHub Release 页面：

1. 选择 tag `0.2.1`；
2. 上传构建后的：
   - `main.js`
   - `manifest.json`
   - `styles.css`
   - `LICENSE`
3. 发布 Release。

如果以后要启用自动 Release：

1. 把 `docs/github-actions-release.yml` 复制为 `.github/workflows/release.yml`；
2. 用有 `workflow` scope 的 GitHub token 或网页提交；
3. 推送新 tag。

## 五、朋友内测：BRAT 或 zip

在进入社区市场前，朋友可以直接测试：

- **zip**：把 `dist/literacy-assessment-0.2.1.zip` 解压到
  `<库>/.obsidian/plugins/literacy-assessment/`；
- **BRAT**：安装 BRAT 插件，添加本仓库，选择 0.2.1 版本；
- 重启 Obsidian，在设置里启用「素养评估」。

测试前提醒朋友：

- 先备份自己的库；
- 不要把真实学生素材提交到公开仓库；
- 先在 demo / 空库试一次 AI 报告和 PDF。

## 六、提交 Obsidian 社区市场

1. 注册/登录 [community.obsidian.md](https://community.obsidian.md)；
2. 关联 GitHub 账号；
3. 添加插件，填写仓库地址；
4. 等自动审核结果，按提示修改后发布新版本；
5. 审核通过后，用户可在 Obsidian 内直接安装。

官方文档：[Submit your plugin](https://docs.obsidian.md/plugins/releasing/submit-plugin)

## 七、发布时需要主动披露的事项

Obsidian 允许一定条件下的闭源/商业插件，但要求 README 明确披露：

- 本插件源码公开，但不是 OSI 开源许可；
- 个人非商业免费；
- 机构/商业部署需要书面授权；
- 使用网络：
  - OpenAI 兼容 AI 接口（用户自己的 Key）；
  - 得到 OpenAPI（用户自己的 Key / Client ID）；
- 无遥测、无广告、无自动更新。

当前 `README.md` 已包含这些说明。

## 八、发布检查清单

- [ ] 仓库 public
- [ ] 无 `demo-vault/`、录音、学生姓名、API Key
- [ ] `manifest.json` 版本 = release tag = `0.2.1`
- [ ] `versions.json` 含 0.2.1
- [ ] `main.js`、`manifest.json`、`styles.css` 已上传 release
- [ ] README 的安装、网络、许可说明完整
- [ ] 在干净库中安装 release 包并启用成功
- [ ] 用测试素材跑一次：同步得到 → 扫描 → AI 整理 → 行动报告 → PDF
- [ ] 用测试素材跑一次：项目总览 → 对外版（化名 + 照片模糊）
- [ ] 确认无真实学生数据进入仓库
