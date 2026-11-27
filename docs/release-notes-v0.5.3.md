# 素养教师工作台 0.5.3

Obsidian 社区审核警告清理：

- 服务端源码已从插件主分支移到独立 `server` Git 分支，不再进入插件源码审核和 Release。
- `src/modal.ts` 已使用 `createSpan`，消除 createEl 警告。
- Release 继续只包含 `main.js`、`manifest.json`、`styles.css`，并保留 Artifact Attestations。
- README 继续说明 vault 文件枚举的范围：只用于本地发现，不上传整库。

服务端部署源码：

```text
https://github.com/PBL-EDU/literacy-assessment/tree/server/server
```
