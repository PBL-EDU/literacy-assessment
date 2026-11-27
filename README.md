# Literacy Teacher Workbench

A local-first Obsidian plugin for evidence-based literacy assessment in project-based learning.

Literacy Teacher Workbench helps educators collect classroom materials, recordings, photos, and observation notes in a **project → action** structure. It uses the AI provider configured by the teacher to transcribe audio, OCR documents, describe images, extract evidence, and draft evidence-linked reports. Materials and reports stay in the local vault.

## What it does

- Organize work as **projects → actions** (a class, workshop, or activity).
- Collect notes, audio, video, images, PDFs, Word documents, and student work in one local vault.
- Run AI organization: transcription, OCR, image descriptions, and evidence extraction with source references.
- Generate:
  - action growth reports;
  - per-student stage reports;
  - per-student project reports;
  - project overview reports;
  - term / school-year reports.
- Keep internal and redacted external report versions. The external version replaces student names with aliases and blurs photos.

## v0.5.0 highlights

- **Multi-framework support.** Each Markdown framework file is a behavior scale. Projects bind a primary framework and optional supplementary frameworks; actions inherit the project binding.
- **Custom levels.** Levels come from the framework's Markdown table (for example L1–L5, A–D, or Chinese level names), not from hard-coded L1–L7.
- **Student literacy profile.** Each student has `03_学员/<student>/素养档案.md` with current levels, challenges, and history. The portfolio can embed the current profile section.
- **Review workflow.** The **Generate report** button becomes **Review report** after generation. A local mentor reviews only level changes and the overall assessment, not every evidence item.
- **Approval gates.** PDF export, redacted external reports, and server push (future) stay unavailable until the report is approved. Teaching feedback is written to a separate file next to the report.
- **Signed organization bundles.** Organization frameworks can be distributed as local signed JSON bundles with hash and Ed25519 verification. Automatic download waits until the server returns.

## Install

Download the matching GitHub Release assets:

```text
main.js
manifest.json
styles.css
```

Place them in:

```text
<vault>/.obsidian/plugins/literacy-assessment/
```

Restart Obsidian and enable **Literacy Teacher Workbench** in **Settings → Community plugins**.

BRAT users can add:

```text
PBL-EDU/literacy-assessment
```

## Quick start

1. Open the plugin from the ribbon or the command **Open literacy assessment panel**.
2. Create a project, group, or student (optional).
3. Create an action and put materials in its `素材/` folder; write mentor observations in `观察/`.
4. Run **Scan** and then **AI organize**.
5. Click **Generate report**. When generation finishes, the same button becomes **Review report**.
6. Review level changes and the overall assessment, then approve.
7. After approval, export PDF or open the redacted external report.

## Data and privacy

- No telemetry and no automatic plugin updates.
- The plugin reads the vault file list to discover framework files, materials, notes and reports. It does not upload the vault or enumerate anything remote.
- AI uploads happen only after the teacher confirms a request: the selected audio, image, document, or prompt is sent to the configured provider.
- In personal mode, the plugin contacts the DeepSeek/GetNote endpoints configured by the teacher.
- In organization mode, the plugin additionally contacts the organization server chosen by the teacher; this server handles invite/device auth, standard framework downloads, AI gateway calls, and usage metadata.
- Organization mode does not upload student reports, evidence, portfolios, or material bodies. The server stores account/membership data, framework Markdown, encrypted organization API key material, and usage counters.
- API keys and materials stay in the local vault except for the explicitly confirmed AI request.
- Teachers are responsible for guardian/institution consent and for complying with applicable privacy and child-protection laws.

## Documentation

- [Chinese user guide](docs/使用指南.md)
- [v0.5.3 operation manual (PDF)](docs/素养教师工作台-操作手册-v0.5.3.pdf)
- [Architecture notes](docs/架构说明.md)
- [Release notes v0.5.3](docs/release-notes-v0.5.3.md)


## Organization server source

The organization backend (`Fastify` + PostgreSQL) is deployment infrastructure and is kept on the separate Git branch:

```text
server
```

It is intentionally not part of the Obsidian plugin release/source review. Plugin releases contain only the plugin runtime.

## Development

Requirements: Node.js 20+, pnpm/npm, Obsidian 1.6.0+.

```bash
npm install
npm run dev        # watch build
npm run verify     # typecheck + production build + tests + smoke test
```

The plugin is desktop-only because it uses Node/Electron APIs for local media processing.

## License

Released under the **GNU Affero General Public License v3.0 (AGPL-3.0-only)**. You may use, modify, and distribute it, including commercially, provided you comply with the AGPL. A separate commercial license is available for organizations that cannot accept the AGPL obligations. See [LICENSE](LICENSE) and [LICENSE-COMMERCIAL.md](LICENSE-COMMERCIAL.md).

## 中文简介

**素养教师工作台**是一个本地优先的 Obsidian 插件，面向项目式学习中的素养评估。老师按「项目 → 行动」收集课堂素材，插件调用老师自己配置的 AI 服务完成转写、OCR、图像说明、证据抽取和报告草稿；素材和报告都保存在本地库。

v0.5.0 支持组织模式、多素养框架、行为量表、学生独立素养档案、`生成报告 → 审核报告`、本地导师审核、教学反馈独立文件，以及批准后才开放 PDF/对外版。中文详细用法见[使用指南](docs/使用指南.md)和[v0.5.0 操作手册](docs/素养教师工作台-操作手册-v0.5.3.pdf)。
