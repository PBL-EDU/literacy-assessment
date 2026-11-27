import os
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

OUT = r"E:\DeepSeek Harness\白日梦计划\素养评估系统\docs\素养教师工作台-操作手册-v0.5.0.docx"
FONT = "Microsoft YaHei"
ACCENT = RGBColor(0x1F, 0x4E, 0x5F)
MUTED = RGBColor(0x5B, 0x67, 0x70)
INK = RGBColor(0x2C, 0x3E, 0x50)
LIGHT = "EAF2F5"
WARN = "FFF4E5"
GREEN = "EEF6F1"

doc = Document()
sec = doc.sections[0]
sec.page_width = Cm(21.0)
sec.page_height = Cm(29.7)
sec.top_margin = Cm(1.8)
sec.bottom_margin = Cm(1.6)
sec.left_margin = Cm(2.0)
sec.right_margin = Cm(2.0)

normal = doc.styles["Normal"]
normal.font.name = FONT
normal.font.size = Pt(10.5)
normal.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
normal.paragraph_format.line_spacing = 1.35
normal.paragraph_format.space_after = Pt(5)

for name, size, color, before, after in [
    ("Title", 30, ACCENT, 0, 8),
    ("Heading 1", 16, ACCENT, 15, 7),
    ("Heading 2", 12.5, ACCENT, 10, 4),
    ("Heading 3", 11, INK, 8, 2),
]:
    st = styles = doc.styles[name]
    st.font.name = FONT
    st.font.size = Pt(size)
    st.font.bold = True
    st.font.color.rgb = color
    st.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    st.paragraph_format.space_before = Pt(before)
    st.paragraph_format.space_after = Pt(after)
    st.paragraph_format.keep_with_next = True

def run_font(run, size=None, bold=None, color=None, italic=None):
    run.font.name = FONT
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), FONT)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if color is not None:
        run.font.color.rgb = color
    if italic is not None:
        run.italic = italic
    return run

def para(text="", bold=False, size=None, color=None, align=None, before=None, after=None):
    p = doc.add_paragraph()
    r = p.add_run(text)
    run_font(r, size=size, bold=bold, color=color)
    if align is not None:
        p.alignment = align
    if before is not None:
        p.paragraph_format.space_before = Pt(before)
    if after is not None:
        p.paragraph_format.space_after = Pt(after)
    return p

def shade(paragraph, fill):
    pPr = paragraph._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    pPr.append(shd)

def callout(title, body, fill=LIGHT, color=ACCENT):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(6)
    r = p.add_run(title + "  ")
    run_font(r, 9.5, True, color)
    r2 = p.add_run(body)
    run_font(r2, 9.5, False, RGBColor(0x33, 0x33, 0x33))
    shade(p, fill)


def figure(filename, caption, width=15.4):
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs", "images", filename)
    doc.add_picture(path, width=Cm(width))
    p = doc.paragraphs[-1]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(2)
    cap = doc.add_paragraph()
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cap.paragraph_format.space_after = Pt(8)
    r = cap.add_run(caption)
    run_font(r, 8.5, False, MUTED)
    r.italic = True

def bullet(text, level=0):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.left_indent = Cm(0.55 + level * 0.55)
    p.paragraph_format.first_line_indent = Cm(-0.35)
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run(text)
    run_font(r)
    return p

def step(num, text):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Cm(0.65)
    p.paragraph_format.first_line_indent = Cm(-0.45)
    p.paragraph_format.space_after = Pt(3)
    r = p.add_run(f"{num}. ")
    run_font(r, 10.5, True, ACCENT)
    r2 = p.add_run(text)
    run_font(r2)
    return p

def page_break():
    doc.add_page_break()

def set_cell_text(cell, text, bold=False, size=9.1, color=None):
    cell.text = ""
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(1)
    r = p.add_run(text)
    run_font(r, size=size, bold=bold, color=color)

def shade_cell(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    tcPr.append(shd)

def table(headers, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, h in enumerate(headers):
        set_cell_text(t.rows[0].cells[i], h, bold=True, size=9.1, color=ACCENT)
        shade_cell(t.rows[0].cells[i], LIGHT)
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            set_cell_text(cells[i], val)
    if widths:
        for i, w in enumerate(widths):
            for row in t.rows:
                row.cells[i].width = Cm(w)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)
    return t

# Footer page number
footer = sec.footer
fp = footer.paragraphs[0]
fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = fp.add_run("素养教师工作台 · 教师操作手册 v0.5.0   |   ")
run_font(r, 8, False, MUTED)
fld = OxmlElement("w:fldSimple")
fld.set(qn("w:instr"), "PAGE")
r2 = OxmlElement("w:r")
t = OxmlElement("w:t")
t.text = "1"
r2.append(t)
fld.append(r2)
fp._p.append(fld)

# ---------------- Cover ----------------
p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(58)
r = p.add_run("素养教师工作台")
run_font(r, 30, True, ACCENT)
p = doc.add_paragraph()
r = p.add_run("Literacy Teacher Workbench")
run_font(r, 13, False, MUTED)
p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(22)
r = p.add_run("Obsidian 插件 · 教师操作手册")
run_font(r, 19, True, INK)
p = doc.add_paragraph()
r = p.add_run("从下载安装，到生成第一份成长报告")
run_font(r, 11.5, False, MUTED)
p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(30)
r = p.add_run("适用版本  v0.5.0")
run_font(r, 11.5, True, ACCENT)
p = doc.add_paragraph()
r = p.add_run("2026-11-25  ·  教师简明版")
run_font(r, 10, False, MUTED)
callout("不需要安装 DeepSeek Harness", "本插件直接调用 DeepSeek 官方 API。你只需要：Obsidian + 本插件 + 一个 DeepSeek API Key。DSH 只是可选的开发工具，教师日常使用不需要。")
p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(14)
r = p.add_run("本地保存素材与报告  ·  导师自带 Key  ·  无服务器")
run_font(r, 9, False, MUTED)

page_break()

# ---------------- 0 目录 ----------------
doc.add_heading("这本手册怎么用", level=1)
para("如果你不熟悉 IT，建议按顺序做，不要跳步：")
for i, item in enumerate([
    "安装 Obsidian（电脑上的笔记软件，免费）。",
    "安装「素养教师工作台」插件。",
    "申请一个 DeepSeek API Key，填进插件。",
    "新建一个项目/行动，放素材，点扫描和 AI 整理。",
    "生成报告并审核，导出 PDF。",
], 1):
    step(i, item)
callout("先记住一件事", "插件不是网页系统，不需要注册账号，也没有云端后台。你的文件和报告都在自己的电脑里；只有主动点 AI 时，素材才会直接发给你配置的 DeepSeek 服务。", GREEN)

doc.add_heading("目录", level=2)
for item in [
    "1. 认识工作台", "2. 下载安装 Obsidian", "3. 安装插件", "4. 配置 DeepSeek",
    "5. 界面与设计", "6. 第一次跑通", "7. OCR / 语音 / 看图", "8. 报告与对外版",
    "9. 文件结构与备份", "10. 隐私与安全", "11. 常见问题", "12. 更新与支持",
]:
    bullet(item)

page_break()

# ---------------- 1 ----------------
doc.add_heading("1  认识工作台", level=1)
para("素养教师工作台是一个 Obsidian 桌面端插件，用来把项目、课程、课堂、活动中的素材，整理成可追溯的素养证据和成长报告。")
doc.add_heading("它做什么", level=2)
for item in [
    "按「项目 → 行动」组织一次课程/活动。",
    "扫描录音、视频、照片、PDF/Word、文字观察。",
    "用 AI 转写、OCR、看图，生成证据和报告草稿。",
    "生成内部版；审核批准后生成对外脱敏版，导出 PDF。",
]:
    bullet(item)
doc.add_heading("它不做什么", level=2)
for item in [
    "不自动给孩子打分或贴标签。",
    "不替导师做最终判断；报告必须由导师复核。",
    "不把素材上传到白日梦服务器；没有遥测。",
    "不要求安装 DeepSeek Harness。",
]:
    bullet(item)
doc.add_heading("一条主线", level=2)
para("项目/小组/同学（可选） → 新建行动 → 放素材 → 扫描 → AI 整理 → 生成报告 → 审核报告 → 导出 PDF → 归档")
callout("设计原则", "本地优先、行动为最小单位、证据可回溯、导师确认、内外两版。所有功能都围绕这五点。", GREEN)

# ---------------- 2 ----------------
doc.add_heading("2  下载安装 Obsidian", level=1)
doc.add_heading("2.1 下载", level=2)
para("打开浏览器，访问 Obsidian 官方下载页：https://obsidian.md/download")
para("根据电脑选择：Windows 下载 .exe；macOS 下载 .dmg。不要从网盘或陌生链接下载修改版。")
doc.add_heading("2.2 安装", level=2)
doc.add_heading("Windows", level=3)
step(1, "双击下载的 .exe。")
step(2, "如果系统提示“是否允许”，选择“是/允许”。")
step(3, "按安装向导完成，桌面会出现 Obsidian 图标。")
doc.add_heading("macOS", level=3)
step(1, "双击 .dmg，把 Obsidian 图标拖到“应用程序”。")
step(2, "第一次打开如果提示“未验证开发者”，到 系统设置 → 隐私与安全性 里选择“仍要打开”。")
doc.add_heading("2.3 创建第一个库（Vault）", level=2)
para("Obsidian 把笔记文件夹叫“库（Vault）”。第一次打开会问你要新建还是打开已有库。")
step(1, "选择“创建新库”。")
step(2, "库名称填：白日梦行动（或你机构的名字）。")
step(3, "位置选一个你容易找到、会自动备份的本地文件夹，例如 D:\\Obsidian\\白日梦行动。")
step(4, "点“创建”。")
callout("重要", "库就是你的全部数据。以后换电脑/备份，复制整个库文件夹即可。不要把库放在临时目录或系统盘深处。", WARN)
para("进入库后，界面是英文还是中文取决于你的 Obsidian 语言设置。可以到 Settings → General → Language 选择中文。")
figure("ob-sidebar-crop.png", "图 1-1 Obsidian 实机界面：右侧「素养评估」栏、项目分组和行动卡。", width=10.5)

page_break()

# ---------------- 3 ----------------
doc.add_heading("3  安装插件", level=1)
para("推荐用 Obsidian 的「社区插件」安装。只有搜索不到时，才用 BRAT 或手动安装。")
doc.add_heading("3.1 方式 A：社区插件（推荐）", level=2)
step(1, "打开 Obsidian → 左下角设置（齿轮）。")
step(2, "左侧选择「第三方插件 / Community plugins」。")
step(3, "如果显示“安全模式/限制模式”，点「关闭安全模式」并确认。")
step(4, "点「浏览 / Browse」，搜索：Literacy Teacher Workbench。")
step(5, "点进插件，选择「安装 / Install」，再点「启用 / Enable」。")
step(6, "右侧栏出现一个剪贴板勾选图标，名称为「素养评估」。")
callout("搜不到怎么办", "插件在 Obsidian 市场使用英文名 Literacy Teacher Workbench；搜索「素养评估」可能搜不到。也可以搜索插件 id：literacy-assessment。", WARN)

doc.add_heading("3.2 方式 B：BRAT（适合需要指定版本）", level=2)
step(1, "先在社区插件里安装并启用 BRAT。")
step(2, "打开 BRAT 设置 → Add Beta Plugin。")
step(3, "填仓库：PBL-EDU/literacy-assessment。")
step(4, "选择版本 0.3.1，安装并启用。")
para("BRAT 适合插件还没出现在市场、或你需要固定版本的情况。")

doc.add_heading("3.3 方式 C：手动安装（最后选择）", level=2)
para("如果前两种都不行，再从 GitHub Release 手动安装。此方式需要找到隐藏的 .obsidian 文件夹，对不熟悉电脑的老师较难。")
step(1, "打开 https://github.com/PBL-EDU/literacy-assessment/releases/tag/0.3.1。")
step(2, "下载 main.js、manifest.json、styles.css 三个文件。")
step(3, "打开你的库文件夹，进入 .obsidian → plugins。")
step(4, "新建文件夹：literacy-assessment。")
step(5, "把三个文件放进这个文件夹（不要多一层文件夹）。")
step(6, "回到 Obsidian → 第三方插件，点刷新，启用 Literacy Teacher Workbench。")
callout("文件夹名必须是 literacy-assessment", "这是插件 id。名字不一致，Obsidian 不会加载。", WARN)

doc.add_heading("3.4 安装后自检", level=2)
for item in [
    "右侧栏能看到「素养评估」按钮。",
    "命令面板（Ctrl/Cmd+P）能搜到「打开素养评估面板」。",
    "设置里出现「素养评估」页。",
]:
    bullet(item)
para("如果都没有：先确认插件已启用，再重启 Obsidian；仍不行，查看第 11 节。")

page_break()

# ---------------- 4 ----------------
doc.add_heading("4  配置 DeepSeek（一次就好）", level=1)
para("工作台优先调用 DeepSeek 官方 API。你只需要一个 DeepSeek API Key；文字、看图、OCR、短音频转写可以共用它。")
doc.add_heading("4.1 申请 API Key", level=2)
step(1, "打开 https://platform.deepseek.com/，注册/登录。")
step(2, "按页面提示完成充值（API 按量计费，不用不扣）。")
step(3, "进入 API Keys / 密钥管理，创建一个新 Key。")
step(4, "复制以 sk- 开头的 Key。只显示一次，先粘到安全的地方。")
callout("不要把 Key 发给别人", "Key 相当于你的账户密码。不要写进微信群、公开文档或学生材料。插件只把 Key 存在本库的插件 data.json 里。", WARN)

doc.add_heading("4.2 填进插件", level=2)
step(1, "Obsidian → 设置 → 素养评估。")
step(2, "在「AI 服务」点「DeepSeek 官方（推荐）」。")
step(3, "粘贴 API Key。")
step(4, "点「测试连接」。看到连接成功即可。")
step(5, "确认视觉模型是 deepseek-flash；文本模型是 deepseek-chat。")
callout("不需要 DeepSeek Harness", "DeepSeek Harness 是开发/研究工具，不是教师使用本插件的前提。插件直接访问 DeepSeek 官方 API。", GREEN)

doc.add_heading("4.3 费用怎么算", level=2)
para("DeepSeek 按实际使用量计费：文字和看图按 token；OCR 按页；短音频转写按音频时长。价格以 DeepSeek 官网为准。")
table(["能力", "计费方式（官方参考）"], [
    ["文字/图像理解", "按输入/输出 token 计费"],
    ["OCR", "约 1.5 元 / 1,000 页"],
    ["语音识别 ASR", "约 0.78 元 / 小时（以官方活动价为准）"],
], widths=[6.5, 9.0])

doc.add_heading("4.4  得到录音卡（长录音默认）", level=2)
para("一节课通常 40–90 分钟，超过 DeepSeek 官方 ASR 的 120 秒限制。长课堂录音的默认做法是：用得到录音卡/录音台录制，让得到完成转写，再把转写同步到工作台。")
step(1, "用得到录音卡或录音台录课，录完在得到 App 里等待「转写 / AI 总结」生成。")
step(2, "打开 设置 → 素养评估 → 得到大脑。")
step(3, "填 API Key 和 Client ID（需要得到大脑会员；在 https://www.biji.com/openapi 创建）。")
step(4, "点「测试得到连接」，确认能读到最近的笔记。")
step(5, "回到右侧栏，点「同步得到」。插件会先暂存到 05_导入/得到/，再按录音时间和内容匹配已有行动。")
step(6, "匹配成功后，转写和总结会复制到行动的 素材/；原始录音保留在 得到/ 暂存区，不会移动。")
callout("为什么长录音默认用得到", "DeepSeek 官方 ASR 只支持 ≤120 秒、≤8 MB 的短音频；长录音直接用插件转写会失败。得到录音卡/录音台负责长录音和转写，插件负责把结果匹配到行动、生成证据和报告。", GREEN)

# ---------------- 5 ----------------
doc.add_heading("5  界面与设计", level=1)
para("工作台不是一堆按钮，而是把导师的工作拆成一条固定流程。了解设计，就不容易迷路。")
doc.add_heading("5.1 右侧栏三层", level=2)
table(["区域", "内容", "用途"], [
    ["行动", "新建项目 / 新建行动", "建立一次课程或活动"],
    ["人", "新建小组 / 新建同学", "建立参与者和固定小组"],
    ["管理", "同步得到 / 查看导入 / 学期总报告", "外部录音与跨项目报告"],
], widths=[3.3, 6.3, 6.3])
doc.add_heading("5.2 行动六步门禁", level=2)
table(["顺序", "按钮", "完成后得到"], [
    ["①", "查看", "打开行动笔记，确认信息"],
    ["②", "扫描", "素材清单.md"],
    ["③", "AI 整理", "转写 / OCR / 图像说明"],
    ["④", "生成报告 / 审核报告", "AI 评估草稿；生成后同一按钮变为审核报告"],
    ["⑤", "PDF", "本地导师批准后才能导出"],
    ["⑥", "归档", "从待办隐藏，文件保留"],
], widths=[1.6, 4.2, 9.5])
callout("为什么有门禁", "前一步没有完成时，后面的按钮灰掉，避免在素材没扫描、没整理时生成空报告。这是给新手的保护，不是限制。", GREEN)

doc.add_heading("5.3 五个设计原则", level=2)
for item in [
    "本地优先：素材、转写、证据、报告都在你的库里。",
    "行动为最小单位：一次课程/活动就是一条行动，多次行动串成项目。",
    "证据优先：每条结论要有来源；没有证据写「未观察到」。",
    "导师确认：AI 只出草稿，不替老师下结论。",
    "内外两版：内部版给导师/监护人；对外版自动化名、模糊照片。",
]:
    bullet(item)

doc.add_heading("5.4 多框架与行为量表", level=2)
para("v0.5.0 支持多个素养框架。每个框架 .md 文件就是一份行为量表，文件里用表格写目标 × level，不再把 level 写死在代码里。")
para("新建项目时选择一个主框架 + 可选补充框架。行动默认继承项目框架；报告记录框架版本。")
p = doc.add_paragraph()
r = p.add_run("框架表格示例：")
run_font(r, 10, True, ACCENT)
table(["目标ID", "目标", "维度", "L1", "L2", "L3", "L4"], [
    ["CCD.3", "与他人协作", "职业认知", "能参与", "能分工", "能协调", "能处理冲突"],
    ["SDU.1", "感知与多角色", "自我认知", "能说出感受", "能识别角色", "能理解差异", "能调整角色"],
], widths=[2.0, 3.0, 2.4, 1.8, 1.8, 1.8, 1.8])
callout("组织用户", "组织强制框架先以签名本地 bundle + hash 校验；被修改或缺失时，正式评估会被阻断。自动下载等服务器恢复后再做。", GREEN)
figure("ob-framework-crop.png", "图 5-2 Obsidian 实机界面：新建项目时选择主框架；项目创建后可再补补充框架。", width=15.0)

doc.add_heading("5.5 学生素养档案", level=2)
para("每个学生有两个文件：")
bullet("03_学员/<学生>/<学生>.md：作品集/同学档案，保留作品与参与记录。")
bullet("03_学员/<学生>/素养档案.md：当前 level、素养挑战、历史。")
para("作品集里用块引用同步当前素养：")
p = doc.add_paragraph()
r = p.add_run("![[03_学员/<学生>/素养档案#当前素养]]")
run_font(r, 9.5, True, ACCENT)
para("level 批准后，插件更新素养档案；作品集里的块显示最新表格。块引用效果需实际使用确认。")
figure("ui-profile.png", "图 5-3 作品集与素养档案：块引用显示当前素养，完整挑战与历史留在素养档案。界面示意。")

doc.add_heading("5.6 生成、审核、教学反馈", level=2)
para("生成报告后，报告状态是「待审核」。同一按钮变为「审核报告」。本地导师只审核两件事：")
bullet("学生 level 是否调整。")
bullet("总体性评估是否通过。")
para("证据供导师查验，不要求逐条确认。未批准：PDF 置灰、不生成对外版、不推送服务器。")
para("每次评估还会生成独立教学反馈：<行动>/报告/教学反馈_<行动>.md；项目/学期同理。教学反馈包含带领建议、证据收集建议、下一次观察重点。")
figure("ob-review-crop.png", "图 5-4 Obsidian 实机界面：审核报告。逐条审核 level 调整和总体性评估；证据供查验，不要求逐条确认。", width=15.0)

doc.add_heading("5.7 组织模式（v0.5）", level=2)
para("v0.5 支持个人模式和组织模式。个人模式继续使用自己的 DeepSeek API Key；组织模式由计划组织者统一结算。")
bullet("未加入组织：使用个人 Key；")
bullet("已加入组织：AI 请求走 https://action.dreamook.com 组织网关；")
bullet("组织失效或不可用：明确提示，不静默改用个人 Key；")
bullet("组织 Key 永远不会下发到插件。")
para("教师在设置页「组织版」输入管理员生成的一次性邀请码和姓名，即可加入组织。加入后，项目/行动的目标选择使用组织发布的多份标准框架。")
para("管理员入口：https://action.dreamook.com/admin/login。组织管理员可上传/发布标准框架、生成邀请码、配置组织 DeepSeek Key、预算和模型价格。")
callout("数据边界", "v0.5 不上传学生报告、证据、素养档案和素材正文；组织网关只记录用量元数据。", GREEN)

doc.add_heading("5.8 多框架分层目标选择", level=2)
para("每个标准框架文件使用「路径」列表达层级。项目和行动选择目标时，菜单会按以下顺序展开：")
para("框架 → 路径第一级 → 路径第二级 → … → 具体目标。")
para("项目可以选择多份框架的目标；行动默认继承项目目标，也可以缩小或补充本次目标。报告只评估选中的目标，并记录框架版本和 hash。")

page_break()

# ---------------- 6 ----------------
doc.add_heading("6  第一次跑通", level=1)
doc.add_heading("第 1 步：建项目 / 小组 / 同学（可选）", level=2)
para("项目用来把同一课程/活动群的多次行动串起来；小组用于固定成员；同学档案用于阶段报告和化名。")
doc.add_heading("第 2 步：新建行动", level=2)
para("右侧栏「新建行动」，填写行动名称、类型、日期、导师、归属项目、参与小组/学员、教学目标。")
para("归属项目可以选「暂不归属」，之后再补。行动会生成自己的文件夹和 素材/ 观察/ 转写/ 证据/ 报告/。")
doc.add_heading("第 3 步：放素材", level=2)
table(["素材", "放哪里", "说明"], [
    ["录音、视频", "素材/", "课堂录音、访谈、活动视频"],
    ["照片、学习单、作品", "素材/", "JPG/PNG/PDF/Word 都可以"],
    ["学生复盘、文字版学习单", "素材/", ".md / .txt"],
    ["导师观察、导师复盘、学习故事", "观察/", "报告最重要的上下文"],
], widths=[5.2, 3.0, 7.0])
doc.add_heading("第 4 步：扫描与 AI 整理", level=2)
step(1, "点「扫描」，生成素材清单，检查文件有没有漏。")
step(2, "点「AI 整理」，插件会转写录音、OCR 文档、给图片写说明。")
step(3, "第一次运行会提示将发送到哪个 AI 服务；确认后开始。")
callout("扫描不等于 AI 整理", "扫描只列文件；AI 整理才会调用 DeepSeek。只写观察笔记也可以直接生成报告，不一定非要录音。", WARN)
doc.add_heading("第 5 步：生成报告并审核", level=2)
para("点「生成报告」，得到证据 JSON、证据 Markdown、行动成长报告、教学反馈和审核记录。")
para("生成后同一按钮变为「审核报告」。在审核面板里逐条确认 level 调整和总体评估；不需要逐条确认证据。")
para("请先自己读一遍：抽查转写、核对证据、改掉不准确的话，再批准。")
doc.add_heading("第 6 步：导出 PDF 和归档", level=2)
para("批准后，报告卡片「PDF」才可用；也可命令面板「导出当前报告为 PDF」，或右键报告文件「导出为 PDF」。")
para("未批准时 PDF 置灰，也不会生成对外版。批准后才生成 _对外.md。")
para("归档后行动从待办列表消失，但文件和报告保留在库中。")

# ---------------- 7 ----------------
doc.add_heading("7  OCR / 语音 / 看图", level=1)
para("v0.5.0 优先调用 DeepSeek 官方 API。三类能力分工不同，不要混用。")
table(["能力", "适合什么", "当前限制"], [
    ["图像理解", "课堂照片、学习单照片、作品照片", "走视觉模型 deepseek-flash；不能替代人工核对"],
    ["OCR", "PDF、Word、PowerPoint、扫描图片", "复杂版式/手写可能有误差；结果按页写入 转写/"],
    ["语音转写", "短语音、口述观察", "DeepSeek 官方只支持 WAV/Ogg、≤8 MB、≤120 秒，无时间戳"],
    ["长录音转写", "整节课堂录音", "默认用得到录音卡/录音台录制，再同步得到；不用插件内 ASR"],
], widths=[3.5, 6.0, 6.5])

doc.add_heading("7.1 文档 OCR", level=2)
para("把 PDF/Word/PowerPoint 放进 素材/，点「AI 整理」。识别结果写入 转写/<文件名>.md，后续报告会读取。")
para("如果 OCR 结果不完整，先打开原文件核对；重要证据不要把 OCR 文本当逐字原文。")

doc.add_heading("7.2 语音转写怎么选", level=2)
table(["你的录音", "建议"], [
    ["WAV/Ogg，≤120 秒", "DeepSeek 官方（设置里选「DeepSeek 官方」）"],
    ["MP3/M4A，或超过 2 分钟", "默认用得到录音卡/录音台录制，再「同步得到」；已有其他转写服务可选 OpenAI 兼容"],
    ["得到大脑录音", "侧栏「同步得到」，直接用现成转写/总结"],
    ["已有逐字稿", "把 .md/.txt 放进 素材/ 或 观察/，不用再转写"],
], widths=[6.0, 9.0])
callout("没有转写也能做报告", "导师观察、学生文字复盘、学习单 OCR 都是证据来源。不要为了转写卡住整个流程。", GREEN)

doc.add_heading("7.3 不需要 DSH", level=2)
para("DeepSeek Harness 的 OCR/看图/语音能力是给 Agent 工作流用的；本插件直接调用 DeepSeek 官方 HTTP API，教师不需要安装 DSH、不需要配置命令行。")

# ---------------- 8 ----------------
doc.add_heading("8  报告与对外版", level=1)
table(["报告", "入口", "覆盖范围"], [
    ["行动成长报告", "行动卡「生成报告」", "一次行动，含参与同学"],
    ["单同学项目成长报告", "项目标题旁「项目报告」", "一个项目 + 一位同学"],
    ["项目总报告", "项目标题旁「项目总览」", "一个项目 + 全部同学"],
    ["单同学阶段报告", "命令面板「生成阶段性成长报告」", "一位同学 + 多个项目/行动"],
    ["学期/学年总报告", "侧栏「管理 → 学期总报告」", "全部项目 + 全部同学"],
], widths=[5.0, 5.3, 5.0])
para("每份报告会生成两个版本：")
bullet("内部版：真实姓名、完整证据和照片，给导师/监护人。")
bullet("对外版：文件名加 _对外.md；姓名用同学档案 alias，未填则同学A/B…；照片模糊。")
para("同学档案可加 alias，例如：alias: \"小星\"。对外版仍然是草稿，发出前请人工检查是否有遗漏。")
callout("报告不是判决书", "报告写的是“这次材料里看到了什么”，不是给孩子下总体结论。家长沟通时请用适龄语言。", WARN)

# ---------------- 9 ----------------
doc.add_heading("9  文件结构与备份", level=1)
table(["目录/文件", "作用"], [
    ["00_框架/", "素养框架文件；报告读取它"],
    ["01_项目/<项目>/", "项目卡片、行动、报告"],
    ["01_项目/<项目>/行动/<日期_名称>/", "素材/观察/转写/证据/报告"],
    ["02_小组/", "固定小组成员"],
    ["03_学员/", "同学档案、阶段/项目报告"],
    ["05_导入/得到/", "得到录音暂存与导入总目录"],
    ["06_报告/", "学期/学年总报告"],
], widths=[7.0, 8.5])
para("备份：关闭 Obsidian，复制整个数据根目录（默认 白日梦行动/）到移动硬盘或云盘。换电脑时把整个库文件夹复制过去即可。")
callout("不要只备份报告", "素材、转写、证据是报告的来源；只备份报告，之后无法复核。", WARN)

# ---------------- 10 ----------------
doc.add_heading("10  隐私与安全", level=1)
for item in [
    "插件没有服务器、没有遥测；文件和报告默认在本地。",
    "只有你主动点 AI 整理/生成报告时，素材才直连你配置的 DeepSeek 服务。",
    "DeepSeek API Key 存在插件 data.json，属于明文；不要把库随便发给别人。",
    "对外分享前：取得监护人/机构同意；隐去学校、地址、正脸和其他孩子信息。",
    "不要用个人微信/网盘随意转发学生原始录音；遵守机构的未成年人信息规定。",
]:
    bullet(item)
para("如果多人共用一台电脑，建议为每位导师建立独立的系统账户或独立 Obsidian 库，避免 Key 和素材混用。")

# ---------------- 11 ----------------
doc.add_heading("11  常见问题", level=1)
table(["现象", "先检查"], [
    ["插件市场搜不到", "搜索英文名 Literacy Teacher Workbench；确认已关闭安全模式"],
    ["启用后没有侧栏", "重启 Obsidian；命令面板搜「打开素养评估面板」"],
    ["AI 404/401", "Base URL 是否正确以 /v1 结尾；Key 是否完整；模型名是否正确"],
    ["看图失败", "视觉模型必须是 deepseek-flash，不要用 deepseek-chat"],
    ["OCR 失败/很慢", "文件是否 ≤100 MB、≤1000 页；复杂扫描件先拆分"],
    ["录音没有转写", "长录音默认用得到录音卡录制并「同步得到」；插件内 DeepSeek ASR 只支持短 WAV/Ogg"],
    ["报告很空", "观察/ 是否有导师复盘；教学目标是否具体；素材是否太少"],
    ["PDF 导出没有反应", "先打开报告 Markdown；确认 Obsidian 支持导出 PDF"],
], widths=[6.2, 9.3])

doc.add_heading("12  更新与支持", level=1)
para("更新方式：")
bullet("社区插件：设置 → 第三方插件 → 检查更新。")
bullet("BRAT：在 BRAT 里更新到 0.3.1。")
bullet("手动安装：下载新版本三个文件，覆盖旧文件；不要删除数据目录。")
para("发布页：https://github.com/PBL-EDU/literacy-assessment/releases")
para("问题反馈：请附上 Obsidian 版本、插件版本、报错截图；不要附真实学生姓名或未脱敏素材。")

doc.add_heading("附：第一次使用检查清单", level=1)
for item in [
    "已安装 Obsidian，并创建自己的库。",
    "已在第三方插件里启用「素养教师工作台」。",
    "已申请 DeepSeek API Key，并完成「测试连接」。",
    "视觉模型是 deepseek-flash，不是 deepseek-chat。",
    "已创建项目/行动，并放好素材和导师观察。",
    "先扫描，再 AI 整理；检查 OCR/转写/图像说明是否生成。",
    "已读一遍报告，抽查至少 2 条证据来源。",
    "已导出 PDF；对外分享前已脱敏并取得同意。",
]:
    bullet(item)
para("把这张清单贴在办公桌旁，第一次使用时逐项打勾，可避免大部分新手问题。")

p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(16)
r = p.add_run("版本：v0.5.0  ·  教师简明版  ·  2026-11-25")
run_font(r, 8.5, False, MUTED)
p = doc.add_paragraph()
r = p.add_run("项目：PBL-EDU/literacy-assessment  ·  详细说明见 docs/使用指南.md")
run_font(r, 8.5, False, MUTED)

doc.save(OUT)
print(OUT)
