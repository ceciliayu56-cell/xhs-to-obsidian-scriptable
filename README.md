# XHS to Obsidian for Scriptable

一套在 iPhone 上运行的小红书视频摘录流程：解析分享链接、转写视频语音、生成结构化摘要，并写入 Obsidian。无需常开 Mac，也不依赖 Coze 或 OpenAI API。

## 功能

- 从剪贴板提取 `xhslink.com` 或 `xiaohongshu.com` 链接
- 解析笔记标题、正文和视频地址
- 使用 Groq Whisper 转写视频语音
- 使用 DeepSeek 生成中文结构化摘要
- 将笔记写入 Obsidian 的 `Inbox` 文件夹
- 将 API Key 保存在 iPhone 的 Scriptable Keychain
- 网络中断时自动重试一次 Groq 上传

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
- 内容摘要
- 视频内容整理
- 核心要点和标签
- 可折叠的视频完整转写

## 隐私与数据流

- Groq 接收视频数据，用于语音转写。
- DeepSeek 接收标题、笔记正文和转写文本，用于生成摘要。
- API Key 通过 Scriptable Keychain 保存在本机，不会写入 Markdown 或仓库。
- 生成的 Markdown 通过 iOS 剪贴板交给 Obsidian。
- Groq 接口路径中的 `/openai/v1/` 是兼容格式；请求域名是 `api.groq.com`，不会发送给 OpenAI。

使用前请阅读 Groq、DeepSeek 和小红书各自的服务条款与隐私政策。

## 限制

- 当前版本仅支持视频笔记，不支持纯图文笔记。
- 视频须小于约 24 MB，以适配 Groq 免费层 25 MB 文件限制。
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

### Obsidian 没有创建笔记

先手动打开一次 Obsidian 并确认系统已注册 `obsidian://` URL Scheme，同时确认当前仓库存在 `Inbox` 文件夹。

## 免责声明

本项目与小红书、Groq、DeepSeek、Scriptable 或 Obsidian 无隶属关系。仅处理你有权访问和摘录的内容，请遵守平台条款与当地法律。

## License

[MIT](LICENSE)
