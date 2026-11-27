# 素养教师工作台 0.5.4

Obsidian 审核剩余警告修复：

- 设置页实现 `getSettingDefinitions()`，兼容 Obsidian 1.13 设置搜索，消除 `PluginSettingTab` 警告。
- 保留 `display()` 作为旧版本 Obsidian 的回退。
- 继续只发布 `main.js`、`manifest.json`、`styles.css`，并保留 Artifact Attestations。
- Vault 枚举仅用于本地发现框架、素材和报告；不上传整个库。
