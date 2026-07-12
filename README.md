# XHS to Obsidian for Scriptable

一套在 iPhone 上运行的小红书图文/视频摘录流程：解析分享链接、识别图片或转写视频、生成结构化摘要，并写入 Obsidian。无需常开 Mac，也不依赖 Coze 或 OpenAI API。

## 功能

- 从剪贴板提取 `xhslink.com` 或 `xiaohongshu.com` 链接
- 自动识别图文或视频笔记
- 提取图文笔记正文和原图，使用 Groq 识别图片文字与画面信息
- 使用 Groq Whisper 转写视频语音
- 使用 DeepSeek 生成中文结构化摘要
- 将笔记写入 Obsidian 的 `Inbox` 文件夹
- 将 API Key 保存在 iPhone 的 Scriptable Keychain
- 图文超过 5 张时自动分批识别
- 视频转写网络中断时自动重试一次

## 需要准备

- iPhone 或 iPad
- [Scriptable](https://scriptable.app/)
- Apple 快捷指令
- [Obsidian](https://obsidian.md/)
- [Groq API Key](https://console.groq.com/keys)
- [DeepSeek API Key](https://platform.deepseek.com/api_keys)

## 安装

1. 下载 [`src/xhs-to-obsidian.js`](src/xhs-to-obsidian.js)。
2. 在 Scriptable 中新建脚本，命名为“`小红书解析`”，放入下载的代码。
3. 新建 Apple 快捷指令，添加 `Scriptable -> Run Script`。
4. 选择“`小红书解析`”，参数全部留空。
5. 开启 `Run In App`；首次粘贴时允许 Scriptable 读取剪贴板。
6. 复制小红书分享文字并运行快捷指令。
7. 首次运行依次输入 Groq 与 DeepSeek API Key。不要把 Key 写进脚本。

## 输出内容

脚本会创建类似下面的文件：

```text
Inbox/2026-07-10-1524-笔记标题.md
```

笔记包括：

- 来源链接和抓取时间
- 小红书原文
- 图文原图和可折叠的图片识别原文
- 内容摘要
- 视频内容整理（视频笔记）
- 核心要点和标签
- 可折叠的视频完整转写（视频笔记）

## 隐私与数据流

- Groq 接收视频数据用于语音转写，或接收图片 URL 用于图文识别。
- DeepSeek 接收标题、笔记正文、视频转写或图片识别文本，用于生成摘要。
- API Key 通过 Scriptable Keychain 保存在本机，不会写入 Markdown 或仓库。
- 生成的 Markdown 通过 iOS 剪贴板交给 Obsidian。
- Groq 接口路径中的 `/openai/v1/` 是兼容格式；请求域名是 `api.groq.com`，不会发送给 OpenAI。

使用前请阅读 Groq、DeepSeek 和小红书各自的服务条款与隐私政策。

## 限制

- 视频须小于约 24 MB，以适配 Groq 免费层 25 MB 文件限制。
- Groq 视觉接口每次最多读取 5 张图片，脚本会自动分批；图片越多，耗时和 API 用量越高。
- OCR 和视觉理解可能出错，政策、金额、日期等信息应回看原图和官方来源。
- Obsidian 中的原图使用小红书 CDN 链接，链接过期后图片可能无法继续显示；识别出的文字和摘要仍会保留。
- 处理期间请保持 Scriptable 在前台，不要锁屏。
- 小红书页面结构变化后，解析规则可能需要更新。
- 默认写入 Obsidian 当前仓库的 `Inbox` 文件夹。

## 常见问题

### 提示剪贴板为空

在 iOS 设置中允许 Scriptable“从其他 App 粘贴”，重新复制小红书分享文字。

### Groq 返回 401

脚本会自动清除无效 Key。重新运行并输入正确的 Groq Key。

### 视频超过限制

当前纯 iPhone 流程不做本地音频压缩。请使用更短的视频，或在代码中接入支持大文件的转写服务。

### 图文只保存了标题或提示找不到图片

重新复制小红书的完整分享链接再运行。若仍失败，笔记可能需要登录、已经失效，或小红书页面结构发生了变化。

## 本地测试

```bash
node tests/parser.test.mjs
```

### Obsidian 没有创建笔记

先手动打开一次 Obsidian 并确认系统已注册 `obsidian://` URL Scheme，同时确认当前仓库存在 `Inbox` 文件夹。

## 免责声明

本项目与小红书、Groq、DeepSeek、Scriptable 或 Obsidian 无隶属关系。仅处理你有权访问和摘录的内容，请遵守平台条款与当地法律。

## License

[MIT](LICENSE)
