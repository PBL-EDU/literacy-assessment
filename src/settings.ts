/**
 * 设置页。
 */
import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type LiteracyAssessmentPlugin from "./main";
import { DEFAULT_SETTINGS } from "./types";
import { resolveFrameworkPath } from "./core";
import { listFrameworks } from "./framework";

export class LiteracySettingTab extends PluginSettingTab {
  plugin: LiteracyAssessmentPlugin;

  constructor(app: App, plugin: LiteracyAssessmentPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const settings = this.plugin.settings;

    new Setting(containerEl).setName("素养评估").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "本地优先：原始素材、转写、证据和报告都保存在当前 Obsidian 库的文件夹里；只有你主动运行 AI 时，素材才会发送到下面配置的服务。",
    });

    /* ---------------- 数据位置 ---------------- */
    new Setting(containerEl).setName("数据位置").setHeading();

    new Setting(containerEl)
      .setName("数据根目录")
      .setDesc("相对库根目录。默认 白日梦行动，下面会建 00_框架 / 01_行动 / 02_学员 / 03_模板。")
      .addText((text) =>
        text.setValue(settings.dataRoot).onChange(async (value) => {
          const next = value.trim() || DEFAULT_SETTINGS.dataRoot;
          if (!settings.frameworkPath.trim() || settings.frameworkPath === DEFAULT_SETTINGS.frameworkPath) {
            settings.frameworkPath = `${next}/00_框架/素养框架.md`;
          }
          settings.dataRoot = next;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("素养框架文件")
      .setDesc(`当前解析为：${resolveFrameworkPath(settings)}。把《职业探索素养路标》的完整内容放进去，报告会读它。`)
      .addText((text) =>
        text.setValue(settings.frameworkPath).onChange(async (value) => {
          settings.frameworkPath = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("目录与模板")
      .setDesc("首次使用时点一下，创建空目录和简版框架。")
      .addButton((button) =>
        button.setButtonText("创建目录结构").onClick(async () => {
          await this.plugin.createDataStructure();
          new Notice("目录结构已准备好。");
        }),
      )
      .addButton((button) =>
        button.setButtonText("打开框架文件").onClick(() => void this.plugin.openFramework()),
      );

    /* ---------------- 框架库 ---------------- */
    new Setting(containerEl).setName("素养框架库").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "每个 .md 文件就是一份行为量表；项目可选择主框架和补充框架。组织框架使用签名 bundle，个人框架直接放在 00_框架/。",
    });
    const frameworkBox = containerEl.createDiv({ cls: "la-framework-list" });
    void this.renderFrameworkList(frameworkBox);
    let bundlePath = "";
    new Setting(containerEl)
      .setName("导入组织框架 bundle")
      .setDesc("把组织提供的 .json bundle 放进库内，填相对路径；会校验 hash 和 Ed25519 签名。个人用户不需要。")
      .addText((text) =>
        text.setPlaceholder("00_框架/_组织/xxx/bundle.json").onChange((value) => {
          bundlePath = value.trim();
        }),
      )
      .addButton((button) =>
        button.setButtonText("校验并导入").onClick(async () => {
          if (!bundlePath) {
            new Notice("先填 bundle 路径。");
            return;
          }
          try {
            const path = await this.plugin.importFrameworkBundle(bundlePath);
            new Notice(`组织框架已导入：${path}`);
            this.display();
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error), 9000);
          }
        }),
      );

    /* ---------------- AI 服务 ---------------- */
    new Setting(containerEl).setName("AI 服务（DeepSeek 官方优先）").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "推荐使用 DeepSeek 官方 API：一个 Key 同时用于文字评估、看图、OCR 和短音频转写。不需要安装 DeepSeek Harness。也可以使用其他 OpenAI 兼容服务。",
    });

    new Setting(containerEl)
      .setName("服务地址")
      .setDesc("OpenAI 兼容的 Base URL，例如 https://api.deepseek.com/v1")
      .addText((text) =>
        text.setValue(settings.aiBaseUrl).onChange(async (value) => {
          settings.aiBaseUrl = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("API Key")
      .setDesc("只保存在本库的插件 data.json 里；不会上传到白日梦服务器。")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setValue(settings.aiApiKey).onChange(async (value) => {
          settings.aiApiKey = value.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("文本模型")
      .setDesc("DeepSeek 推荐 deepseek-chat；看图模型在下面的「视觉模型」单独设置。")
      .addText((text) =>
        text.setValue(settings.aiModel).onChange(async (value) => {
          settings.aiModel = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("预设")
      .setDesc("一键填入推荐地址与模型；Key 仍需自己填。")
      .addButton((button) =>
        button.setButtonText("DeepSeek 官方（推荐）").onClick(async () => {
          settings.aiBaseUrl = "https://api.deepseek.com/v1";
          settings.aiModel = "deepseek-chat";
          settings.visionModel = "deepseek-flash";
          settings.ocrBaseUrl = "https://api.deepseek.com/v1";
          settings.asrProvider = "deepseek";
          settings.asrBaseUrl = "https://api.deepseek.com/v1";
          await this.plugin.saveSettings();
          this.display();
        }),
      )
      .addButton((button) =>
        button.setButtonText("OpenAI").onClick(async () => {
          settings.aiBaseUrl = "https://api.openai.com/v1";
          settings.aiModel = "gpt-4o-mini";
          await this.plugin.saveSettings();
          this.display();
        }),
      )
      .addButton((button) =>
        button.setButtonText("Ollama 本地").onClick(async () => {
          settings.aiBaseUrl = "http://127.0.0.1:11434/v1";
          settings.aiModel = "qwen2.5:7b";
          settings.aiApiKey = "ollama";
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName("温度")
      .setDesc("0-1；评估建议 0.2-0.4。")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.step = "0.1";
        text.setValue(String(settings.aiTemperature)).onChange(async (value) => {
          const n = Number(value);
          if (Number.isFinite(n)) {
            settings.aiTemperature = Math.min(1, Math.max(0, n));
            await this.plugin.saveSettings();
          }
        });
      });

    new Setting(containerEl)
      .setName("最大输出 token")
      .addText((text) => {
        text.inputEl.type = "number";
        text.setValue(String(settings.aiMaxTokens)).onChange(async (value) => {
          const n = Number(value);
          if (Number.isFinite(n) && n >= 512) {
            settings.aiMaxTokens = Math.round(n);
            await this.plugin.saveSettings();
          }
        });
      });

    new Setting(containerEl)
      .setName("请求超时（毫秒）")
      .addText((text) => {
        text.inputEl.type = "number";
        text.setValue(String(settings.aiTimeoutMs)).onChange(async (value) => {
          const n = Number(value);
          if (Number.isFinite(n) && n >= 10_000) {
            settings.aiTimeoutMs = Math.round(n);
            await this.plugin.saveSettings();
          }
        });
      });

    new Setting(containerEl)
      .setName("连接测试")
      .setDesc("发一条最小请求，确认地址、Key、模型是否可用。")
      .addButton((button) =>
        button.setButtonText("测试连接").onClick(async () => {
          button.setDisabled(true);
          button.setButtonText("测试中…");
          try {
            await this.plugin.testAiConnection();
            new Notice("AI 连接成功。");
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error), 8000);
          } finally {
            button.setDisabled(false);
            button.setButtonText("测试连接");
          }
        }),
      );

    /* ---------------- 语音转写 ---------------- */
    new Setting(containerEl).setName("语音转写").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "长课堂录音默认用「得到录音卡/录音台」录制，等待得到转写后在侧栏点「同步得到」。DeepSeek 官方 ASR 只用于短语音（WAV/Ogg，≤8 MB、≤120 秒）；MP3/M4A 或长录音也可另配 OpenAI 兼容服务。",
    });

    new Setting(containerEl)
      .setName("启用转写")
      .setDesc("录音/视频会发送到下面的服务转成文字。")
      .addToggle((toggle) =>
        toggle.setValue(settings.asrEnabled).onChange(async (value) => {
          settings.asrEnabled = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("转写服务")
      .setDesc("短音频用 DeepSeek；长课堂录音默认用得到录音卡录制并「同步得到」，也可选 OpenAI 兼容服务。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("deepseek", "DeepSeek 官方（短音频）")
          .addOption("openai", "OpenAI 兼容 /audio/transcriptions")
          .setValue(settings.asrProvider)
          .onChange(async (value) => {
            settings.asrProvider = value === "deepseek" ? "deepseek" : "openai";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("转写服务地址")
      .setDesc("DeepSeek 填 https://api.deepseek.com/v1；OpenAI 兼容填到 /v1")
      .addText((text) =>
        text.setValue(settings.asrBaseUrl).onChange(async (value) => {
          settings.asrBaseUrl = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("转写 API Key")
      .setDesc("DeepSeek 官方可留空，自动使用上面的 AI Key；其他服务请单独填。")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setValue(settings.asrApiKey).onChange(async (value) => {
          settings.asrApiKey = value.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("转写预设")
      .setDesc("只填地址和模型名，Key 仍需自己填。")
      .addButton((button) =>
        button.setButtonText("DeepSeek 官方").onClick(async () => {
          settings.asrProvider = "deepseek";
          settings.asrBaseUrl = "https://api.deepseek.com/v1";
          settings.asrLanguage = "zh";
          await this.plugin.saveSettings();
          this.display();
        }),
      )
      .addButton((button) =>
        button.setButtonText("硅基流动").onClick(async () => {
          settings.asrProvider = "openai";
          settings.asrBaseUrl = "https://api.siliconflow.cn/v1";
          settings.asrModel = "FunAudioLLM/SenseVoiceSmall";
          settings.asrLanguage = "zh";
          await this.plugin.saveSettings();
          this.display();
        }),
      )
      .addButton((button) =>
        button.setButtonText("OpenAI").onClick(async () => {
          settings.asrProvider = "openai";
          settings.asrBaseUrl = "https://api.openai.com/v1";
          settings.asrModel = "whisper-1";
          settings.asrLanguage = "zh";
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName("转写模型")
      .setDesc("例如 whisper-1 / FunAudioLLM/SenseVoiceSmall；以服务商文档为准。")
      .addText((text) =>
        text.setValue(settings.asrModel).onChange(async (value) => {
          settings.asrModel = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("语言")
      .setDesc("zh / en / auto；按服务商支持情况填。")
      .addText((text) =>
        text.setValue(settings.asrLanguage).onChange(async (value) => {
          settings.asrLanguage = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    /* ---------------- 图像理解 ---------------- */
    new Setting(containerEl).setName("图像理解").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "视觉模型必须支持图片输入；deepseek-chat 等纯文本模型不能看图。视频会抽 3 个关键帧后走同一个视觉模型。",
    });

    new Setting(containerEl)
      .setName("启用图像说明")
      .setDesc("课堂照片、学习单照片会发送给视觉模型写观察说明。")
      .addToggle((toggle) =>
        toggle.setValue(settings.visionEnabled).onChange(async (value) => {
          settings.visionEnabled = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("视觉模型")
      .setDesc("留空则用上面的文本模型。需要模型支持 image_url 输入。")
      .addText((text) =>
        text.setValue(settings.visionModel).onChange(async (value) => {
          settings.visionModel = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("单次最多处理图片数")
      .setDesc("控制费用；剩下的下次再跑。")
      .addText((text) => {
        text.inputEl.type = "number";
        text.setValue(String(settings.visionMaxImages)).onChange(async (value) => {
          const n = Number(value);
          if (Number.isFinite(n) && n >= 1) {
            settings.visionMaxImages = Math.round(n);
            await this.plugin.saveSettings();
          }
        });
      });

    /* ---------------- OCR ---------------- */
    new Setting(containerEl).setName("OCR（PDF/Word/PowerPoint）").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "DeepSeek 官方 OCR 可以把 PDF、Word、PowerPoint 和图片识别成文字，写入 转写/，供后续证据和报告使用。按页计费；API Key 默认复用上面的 AI Key。",
    });

    new Setting(containerEl)
      .setName("启用 OCR")
      .setDesc("AI 整理时自动识别 素材/ 里的 PDF/Word/PowerPoint。")
      .addToggle((toggle) =>
        toggle.setValue(settings.ocrEnabled).onChange(async (value) => {
          settings.ocrEnabled = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("OCR 服务地址")
      .setDesc("默认 https://api.deepseek.com/v1")
      .addText((text) =>
        text.setValue(settings.ocrBaseUrl).onChange(async (value) => {
          settings.ocrBaseUrl = value.trim() || "https://api.deepseek.com/v1";
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("OCR API Key")
      .setDesc("留空则使用上面的 AI Key。")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setValue(settings.ocrApiKey).onChange(async (value) => {
          settings.ocrApiKey = value.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("识别方式")
      .setDesc("text_recognition 更快；rich_layout_recognition 更适合复杂版式，但输出更长。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("text_recognition", "纯文字提取")
          .addOption("rich_layout_recognition", "保留版式识别")
          .setValue(settings.ocrPurpose)
          .onChange(async (value) => {
            settings.ocrPurpose = value === "rich_layout_recognition" ? "rich_layout_recognition" : "text_recognition";
            await this.plugin.saveSettings();
          }),
      );

    /* ---------------- 得到大脑 ---------------- */
    new Setting(containerEl).setName("得到大脑（录音接入）").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "得到大脑 OpenAPI 仅对会员开放；需要 API Key + Client ID（在 https://www.biji.com/openapi 创建）。插件只读取录音笔记、转写和音频，不修改你的得到笔记。",
    });

    new Setting(containerEl)
      .setName("API 地址")
      .setDesc("默认 https://openapi.biji.com/open/api/v1")
      .addText((text) =>
        text.setValue(settings.getnoteApiBase).onChange(async (value) => {
          settings.getnoteApiBase = value.trim() || "https://openapi.biji.com/open/api/v1";
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("API Key")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setValue(settings.getnoteApiKey).onChange(async (value) => {
          settings.getnoteApiKey = value.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Client ID")
      .addText((text) =>
        text.setValue(settings.getnoteClientId).onChange(async (value) => {
          settings.getnoteClientId = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("录音来源")
      .setDesc("不确定就选「全部」；录音卡选 GetSeed，录音台选 MOAN")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("all", "全部")
          .addOption("getseed", "GetSeed 录音卡")
          .addOption("vendor_moan", "MOAN/得到录音台")
          .addOption("dedao", "得到")
          .setValue(settings.getnoteSource)
          .onChange(async (value) => {
            settings.getnoteSource = value as typeof settings.getnoteSource;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("同步最近几天")
      .addText((text) => {
        text.inputEl.type = "number";
        text.setValue(String(settings.getnoteSyncDays)).onChange(async (value) => {
          const n = Number(value);
          if (Number.isFinite(n) && n >= 1) {
            settings.getnoteSyncDays = Math.round(n);
            await this.plugin.saveSettings();
          }
        });
      });

    new Setting(containerEl)
      .setName("时间匹配窗口（小时）")
      .setDesc("录音时间和行动时间相差多少小时内视为可能匹配；最终还会看内容关键词。")
      .addText((text) => {
        text.inputEl.type = "number";
        text.setValue(String(settings.getnoteMatchHours)).onChange(async (value) => {
          const n = Number(value);
          if (Number.isFinite(n) && n >= 1) {
            settings.getnoteMatchHours = Math.round(n);
            await this.plugin.saveSettings();
          }
        });
      });

    new Setting(containerEl)
      .setName("下载原始录音到素材/")
      .setDesc("开启后会把得到录音音频下载到匹配到的行动文件夹；关闭则只保存转写。")
      .addToggle((toggle) =>
        toggle.setValue(settings.getnoteDownloadAudio).onChange(async (value) => {
          settings.getnoteDownloadAudio = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("连接测试")
      .setDesc("只读最近 1 天的 1 条笔记，确认 Key/Client ID/会员状态。")
      .addButton((button) =>
        button.setButtonText("测试得到连接").onClick(async () => {
          button.setDisabled(true);
          button.setButtonText("测试中…");
          try {
            const count = await this.plugin.testGetnoteConnection();
            new Notice(`得到大脑连接成功（最近 1 天返回 ${count} 条笔记）。`);
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error), 9000);
          } finally {
            button.setDisabled(false);
            button.setButtonText("测试得到连接");
          }
        }),
      );

    /* ---------------- 报告与隐私 ---------------- */
    new Setting(containerEl).setName("报告与隐私").setHeading();

    new Setting(containerEl)
      .setName("单次上下文上限（字符）")
      .setDesc("超过后按优先级截断：导师观察优先，其次转写，最后素材文字。")
      .addText((text) => {
        text.inputEl.type = "number";
        text.setValue(String(settings.maxContextChars)).onChange(async (value) => {
          const n = Number(value);
          if (Number.isFinite(n) && n >= 5000) {
            settings.maxContextChars = Math.round(n);
            await this.plugin.saveSettings();
          }
        });
      });

    new Setting(containerEl)
      .setName("发送前确认")
      .setDesc("每次调用 AI 前弹窗确认，并提示监护人/机构授权。建议保持开启。")
      .addToggle((toggle) =>
        toggle.setValue(settings.confirmBeforeUpload).onChange(async (value) => {
          settings.confirmBeforeUpload = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("生成后自动打开报告")
      .addToggle((toggle) =>
        toggle.setValue(settings.autoOpenReport).onChange(async (value) => {
          settings.autoOpenReport = value;
          await this.plugin.saveSettings();
        }),
      );

    /* ---------------- 关于 ---------------- */
    new Setting(containerEl).setName("关于").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "素养评估 v0.4.0 · 本地优先。素材与报告归导师保管；公开分享前请单独取得监护人同意并做脱敏。",
    });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "授权：个人导师免费使用；机构（2 位及以上导师、机构系统、收费服务、白标/OEM）需书面授权。完整条款见插件目录 LICENSE。",
    });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: `当前默认框架文件（兼容）：${resolveFrameworkPath(settings)}`,
    });
  }

  private async renderFrameworkList(container: HTMLElement): Promise<void> {
    container.empty();
    const frameworks = await listFrameworks(this.app, this.plugin.settings);
    if (!frameworks.length) {
      container.createEl("p", {
        cls: "setting-item-description",
        text: "还没有解析到框架。把一份带「目标 × level 表格」的 .md 放到 00_框架/。",
      });
    }
    for (const framework of frameworks) {
      const row = container.createDiv({ cls: "la-framework-row" });
      row.createEl("strong", { text: `${framework.name}  v${framework.version}` });
      row.createDiv({
        cls: "setting-item-description",
        text: `${framework.id} · ${framework.levels.length} 个 level · ${framework.goals.length} 个目标`,
      });
      if (framework.errors.length) {
        row.createDiv({
          cls: "setting-item-description",
          text: `⚠ ${framework.errors.join("；")}`,
        });
      }
    }
    const refresh = container.createEl("button", { cls: "la-btn", text: "刷新框架库" });
    refresh.onclick = () => void this.renderFrameworkList(container);
  }
}

