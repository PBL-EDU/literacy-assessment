# 国内 AI 服务商清单（语音转写 / 图像与视频理解）

> 核对时间：2026-11-06。模型名、限额、价格会变，接入前以服务商控制台和官方文档为准。
> 适用对象：素养评估插件 v0.1。插件只认两种 OpenAI 兼容接口：
> 1. **语音转写**：`POST /audio/transcriptions`（multipart，字段 `file` + `model`）；
> 2. **图像理解**：`POST /chat/completions`，消息里带 `image_url`（最好是 `data:image/...;base64,...`）。
>
> 表格里 **✅ 可直接接** 表示当前插件不改代码就能用；**⚠️ 需适配** 表示接口不是 OpenAI 兼容，需要加适配器或手工转写；**❌** 表示不适用。
>
> 授权模式：个人版由导师自己申请 Key、自己付费；机构版可以统一采购/统一网关，也可以各自 BYOK。插件本身不提供模型 API、不代收模型费。

## 一、先给结论

| 场景 | 推荐 | 原因 |
| --- | --- | --- |
| 一套 Key 同时做转写 + 看图，录音 ≤1 小时 | **硅基流动 SiliconFlow** | ASR 和视觉都兼容 OpenAI；国内访问；一个 Key |
| 长录音（45 MB / 1 小时 39 分） | **阿里云百炼 Qwen-ASR-Filetrans**（需适配）或先用**得到大脑/飞书妙记**导出文字 | 12 小时 / 2 GB；但接口不是 `/audio/transcriptions`，v0.1 不能直接填 |
| 要时间戳、录音 ≤25 MB | **OpenAI Whisper** | `verbose_json` 返回分段；非国内 |
| 企业采购/发票/合规优先 | **阿里云百炼、火山方舟、腾讯云、智谱** | 国内主体、合同与发票；视觉可接，ASR 多数要适配 |
| 只想生成文字报告 | **DeepSeek + 得到大脑/飞书妙记文本** | 不需要 ASR；把 `.md`/`.txt` 放进素材或观察即可 |

## 二、语音转写（ASR）

| 服务商 | 接口 | 模型示例 | 单文件限制 | 时间戳 | 与 v0.1 兼容 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| **硅基流动** | `POST https://api.siliconflow.cn/v1/audio/transcriptions` | `FunAudioLLM/SenseVoiceSmall`、`TeleAI/TeleSpeechASR` | 50 MB / 1 小时 | 否，只返回 `text` | ✅ 可直接接 | 国内；与视觉共用 Key；长录音要切分 |
| **OpenAI** | `POST https://api.openai.com/v1/audio/transcriptions` | `whisper-1` | 25 MB | 是，`verbose_json` 有 segments | ✅ 可直接接 | 非国内；需网络与合规评估 |
| **阿里云百炼** | `qwen3-asr-flash`：`chat/completions` + `input_audio`；`qwen3-asr-flash-filetrans`：异步原生接口 | `qwen3-asr-flash`、`qwen3-asr-flash-filetrans` | 同步 5 分钟 / 10 MB；异步 12 小时 / 2 GB | 异步有句级时间戳 | ⚠️ 需适配 | 长课堂录音首选；不是 `/audio/transcriptions` |
| **腾讯云 ASR** | 录音文件识别（原生 API） | — | 长音频 | 有 | ⚠️ 需适配 | 需签名/SDK；适合企业已有腾讯云 |
| **讯飞开放平台** | 录音文件转写（原生 API） | — | 长音频 | 有 | ⚠️ 需适配 | 中文识别老牌；需签名 |
| **火山引擎** | 录音文件识别（原生 API） | — | 长音频 | 有 | ⚠️ 需适配 | 与方舟视觉同一体系 |
| **百度语音** | 录音文件识别（原生 API） | — | 长音频 | 有 | ⚠️ 需适配 | 需签名 |

**要点：**

- 插件 v0.1 的 ASR 是「OpenAI 兼容 multipart」，所以**只有硅基流动和 OpenAI 能直接填**。阿里云/腾讯/讯飞/火山/百度都属于「原生接口」，填进插件会 404 或参数错误。
- 硅基流动只返回整段文字，没有时间戳；报告里的证据来源会显示「无时间戳」。要时间戳用 OpenAI Whisper 或阿里云 filetrans（需适配）。
- 45 MB 的课堂录音：OpenAI 25 MB 超限；硅基流动 1 小时也超限。**要么切分/压缩，要么用长音频原生接口，要么直接用得到大脑/飞书妙记的转写文字。**

## 三、图像理解（视觉模型）

插件会把照片/学习单缩放后转成 base64 data URL，发给 `chat/completions`。所以需要：**OpenAI 兼容 + 支持 `image_url` + 最好支持 base64**。

| 服务商 | Base URL | 模型示例 | base64 | 与 v0.1 兼容 | 备注 |
| --- | --- | --- | --- | --- | --- |
| **硅基流动** | `https://api.siliconflow.cn/v1` | 模型广场筛选「视觉」；如 Qwen2.5-VL 系列 | ✅ 文档明确支持 | ✅ 可直接接 | 与 ASR 共用 Key；模型名以广场为准 |
| **阿里云百炼** | `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`（旧域名 `https://dashscope.aliyuncs.com/compatible-mode/v1` 仍可用） | Qwen-VL 系列（如 `qwen-vl-plus` / `qwen-vl-max`，以控制台为准） | ✅ 文档支持 | ✅ 可直接接 | 国内合规、发票；注意 API Key 与地域绑定 |
| **火山方舟** | `https://ark.cn-beijing.volces.com/api/v3` | Doubao 视觉系列 | 需按官方文档确认 | ✅ chat 兼容 | 与火山语音同一账号体系 |
| **智谱 BigModel** | `https://open.bigmodel.cn/api/paas/v4` | GLM-4V / GLM-4.5V（以控制台为准） | 需按官方文档确认 | ✅ chat 兼容 | 国内；有免费/低价视觉模型 |
| **月之暗面 Kimi** | `https://api.moonshot.cn/v1` | Kimi 视觉模型（以控制台为准） | 需按官方文档确认 | ✅ chat 兼容 | 长上下文见长 |
| **阶跃星辰 StepFun** | `https://api.stepfun.com/v1` | Step 视觉模型（以控制台为准） | 需按官方文档确认 | ✅ chat 兼容 | 文档有图片理解示例 |
| **腾讯混元 / TokenHub** | `https://api.hunyuan.cloud.tencent.com/v1`（旧）；TokenHub 新域名以控制台为准 | Hunyuan-Vision 系列 | 需按官方文档确认 | ✅ chat 兼容 | 腾讯云体系；文档正在迁 TokenHub |
| **百度千帆** | `https://qianfan.baidubce.com/v2` | ERNIE-VL 系列 | 需按官方文档确认 | ✅ chat 兼容 | 百度云体系 |
| **商汤 SenseNova** | `https://api.sensenova.cn/compatible-mode/v1` | SenseNova 视觉系列 | 需按官方文档确认 | ✅ chat 兼容 | 以控制台为准 |
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4o-mini` 等 | ✅ | ✅ 可直接接 | 非国内；需合规评估 |

**要点：**

- 图片理解不要求服务商提供「视频接口」；插件的视频处理是**本地抽 3 帧**，再走图片理解。所以上表任何视觉模型都能处理视频画面。
- 如果服务商只接受公网图片 URL、不接受 base64，当前插件不能直接用；需要先把图片上传到 OSS/图床再传 URL（v0.1 未做）。
- `deepseek-chat` 是文本模型，不能看图；DeepSeek 的视觉能力要看其当前是否开放独立视觉模型。
- 模型名和价格变化快，**以控制台「模型广场/模型列表」为准**，不要照抄本文档的示例。

## 四、视频理解

| 方式 | 说明 | 与 v0.1 兼容 |
| --- | --- | --- |
| 本地抽 3 帧 + 图片理解 | 插件当前做法；音轨另走 ASR | ✅ |
| 服务商原生视频理解（Qwen-VL 视频、Doubao 视频、Gemini 等） | 直接把视频文件/URL 交给模型 | ⚠️ 需适配；v0.1 未接 |
| 只转写音轨 | 不上画面，只出文字 | ✅ |

对课堂视频，建议先用「抽帧 + 音轨转写」，成本低、证据也够用；原生视频理解更贵，等 v0.3 再评估。

## 五、长录音的四种现实做法

| 做法 | 优点 | 缺点 |
| --- | --- | --- |
| 得到大脑 / 飞书妙记 / 通义听悟 / 讯飞听见导出文字 | 不用配 ASR；已有总结/逐字稿 | 格式不一；可能要手动整理；总结会丢细节 |
| 切成 ≤1 小时片段，走硅基流动 | 国内、便宜、OpenAI 兼容 | 要切分；时间戳会断；片段边界可能截断句子 |
| 压缩/切到 ≤25 MB，走 OpenAI Whisper | 有时间戳 | 需要压缩工具；非国内 |
| 阿里云 Qwen-ASR-Filetrans（12h/2GB） | 最适合长课堂 | 需要适配器；要公网可访问 URL 或 OSS；v0.1 未接 |

> 45 MB / 1 小时 39 分的录音，最省事的是先看「得到大脑」有没有导出文字；没有的话，v0.2 加阿里云 filetrans 适配器，或先用音频工具切两段。

## 六、按场景的推荐组合

### 场景 A：一周几次课，录音 ≤1 小时，有照片

- 文字报告：硅基流动文本模型（或 DeepSeek）
- 转写：硅基流动 `FunAudioLLM/SenseVoiceSmall`
- 看图：硅基流动视觉模型
- 一个 Key，设置里三处都填同一个 Key；Base URL 都是 `https://api.siliconflow.cn/v1`。

### 场景 B：长课堂录音（1–2 小时）

- 首选：得到大脑/飞书妙记导出文字 → 放进 `观察/` 或 `素材/` → 直接生成报告。
- 要 API：阿里云 Qwen-ASR-Filetrans（需适配）或腾讯云/讯飞录音文件识别（需适配）。
- 临时方案：切两段 ≤1 小时，走硅基流动。

### 场景 C：企业/基金会采购，要发票与合规

- 视觉：阿里云百炼、火山方舟、腾讯云、智谱。
- 转写：优先用其原生长音频接口，需加适配器；或者用得到/飞书导出文字。
- 签数据处理协议，确认数据地域、是否用于训练、保留期限。

### 场景 D：只想零成本跑通

- 文字：DeepSeek（便宜）
- 转写：得到大脑/飞书妙记免费额度
- 看图：先关闭图像理解，只读导师复盘与文字学习单

## 七、接入前检查清单

1. **接口**：是不是 OpenAI 兼容？ASR 是不是 `/audio/transcriptions`？视觉是不是 `chat/completions` + `image_url`？
2. **大小/时长**：单文件上限多少？超了是报错还是截断？
3. **base64**：视觉接口接不接受 `data:image/...;base64,...`？只接受 URL 的话，当前插件不能直接用。
4. **返回格式**：ASR 返回 `text` 还是 `segments`？没有 segments 就没有时间戳。
5. **合规**：境内节点、数据是否用于训练、保留期限、发票/合同、未成年人数据条款。
6. **稳定性**：模型名是否固定？是否随时下线？有没有备用模型？
7. **成本**：转写按分钟还是按 token？视觉按图片 token？先小样本试。

## 八、官方文档

- 硅基流动 ASR：<https://docs.siliconflow.cn/docs/api/audio-transcriptions-post>
- 硅基流动视觉：<https://docs.siliconflow.cn/docs/userguide/capabilities/vision>
- 阿里云百炼 OpenAI 兼容：<https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope>
- 阿里云百炼语音识别：<https://help.aliyun.com/zh/model-studio/asr-model>
- 阿里云百炼 Qwen-ASR API：<https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference>
- 阿里云视觉理解：<https://www.alibabacloud.com/help/en/model-studio/vision>
- 火山方舟 Chat API：<https://docs.volcengine.com/docs/ark/chat-api>
- 智谱开放平台：<https://docs.bigmodel.cn/>
- Kimi Chat API：<https://platform.kimi.com/docs/api/chat>
- 阶跃星辰图片理解：<https://platform.stepfun.com/docs/zh/guides/developer/image-chat>
- 腾讯云 ASR：<https://cloud.tencent.com/document/product/1093>
- 讯飞语音听写/转写：<https://www.xfyun.cn/doc/asr/voicedictation/API.html>
- 火山引擎语音：<https://www.volcengine.com/docs/6561>
- 百度语音：<https://ai.baidu.com/ai-doc/SPEECH>

> 说明：本文档只做兼容性梳理，不构成采购或法律建议。模型/价格/限额以服务商控制台为准。
