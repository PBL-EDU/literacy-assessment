# 素养教师工作台 0.5.2

社区审核警告修复：

- 插件 `src/modal.ts` 改用 `createSpan`，消除 Obsidian createEl 警告。
- 服务端源码按独立部署代码处理，显式关闭其 ESLint 扫描，避免服务端 Node/Fastify 代码被当作 Obsidian 插件源码扫描。
- 保持 0.5.1 的 release 资产和 Artifact Attestations。
- Vault 枚举用途已在 README 中说明：只用于发现框架、素材和报告文件，不上传整个库。

Release assets 仍然只有：

```text
main.js
manifest.json
styles.css
```
