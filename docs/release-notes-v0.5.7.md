# 素养教师工作台 0.5.7

Obsidian 审核修复：

- `manifest.json` 的 `minAppVersion` 调整为 `1.13.0`，与设置页使用的声明式设置 API 一致。
- `getSettingDefinitions()` 只在支持该 API 的 Obsidian 版本中运行。
- Release assets 仍然只有 `main.js`、`manifest.json`、`styles.css`，并保留 Artifact Attestations。
- 一级素养默认收起；展开后二级目标直接多选。

注意：0.5.7 需要 Obsidian 1.13.0 或更高版本。
