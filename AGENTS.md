# 素养教师工作台 · Workspace Rules

本工作区根目录：

```text
E:\DeepSeek Harness\白日梦计划\素养评估系统
```

## 文档所有权

- 唯一 active 需求源：`internal/requirements/需求池.md`
- 已确认功能规格：`internal/requirements/功能需求-*.md`
- 团队讨论底稿：`internal/requirements/团队讨论稿.md`
- 研究/验证：`internal/research/<专题>/`
- 商业与提示词：`internal/business/`、`internal/prompts/`
- 公开文档：`docs/`
- 内部目录整体被 `.gitignore` 忽略，不能提交到公开 GitHub。

## 专题分叉规则

1. 新专题先建 `internal/research/<专题>/`，写 `BRIEF.md`。
2. 分叉不新建需求池、不新建第二套需求管理文档。
3. 结束只交回 `HANDOFF.md`：已确认决策、需求候选、未决问题、证据/产物、来源会话。
4. 主会话只读 HANDOFF，把候选合并进唯一需求池。
5. 需要团队讨论时，在飞书文档 1 增补主题章节；文档 2 只镜像唯一需求池。
6. 不把分叉完整聊天记录复制进主会话，避免上下文膨胀。

## 公开 / 内部

公开：`docs/` 中用户、架构、发布、法务和图片文档。

内部：`internal/`、`demo-vault/`、`design/`、`dist/`、探针脚本、真实学生素材。

## 开发规则

- 讨论阶段只记录，不逐条开发/发版。
- 需求池累计到 5–8 个已确认项或形成完整主题后，再做版本规划。
- 不在未确认前修改正式需求或发布插件版本。
