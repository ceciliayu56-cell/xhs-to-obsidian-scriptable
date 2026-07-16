# XHS to Obsidian- CN

一套在 iPhone/iPad 上运行的小红书图文与视频摘录流程：解析分享链接，用千问大模型识别图片、视频画面、字幕和声音，生成结构化摘要，再写入 Obsidian。

`CN` 仅是这个 GitHub Skill 的名称标识，不会改写 Obsidian 笔记的标题、文件名或标签。

## 主要功能

- 从剪贴板提取 `xhslink.com` 或 `xiaohongshu.com` 链接。
- 自动识别图文或视频笔记。
- 千问大模型负责图片 OCR、画面理解和结构化总结。
- 视频根据时长在有免费额度的 HTTP 全模态模型中自动轮转。
- 额度用尽、限流或模型不适配时自动切换。
- 视频完整理解失败时，如果小红书提供中文字幕，自动使用字幕继续整理。
- 将 API Key 保存在 iPhone 的 Scriptable Keychain。
- 图文超过 5 张时自动分批识别。
- 网络中断时自动重试，最终失败也会保留完整识别原文。

## 需要准备

- iPhone 或 iPad
- [Scriptable](https://scriptable.app/)
- Apple 快捷指令
- [Obsidian](https://obsidian.md/)
- 阿里云百炼 API Key（华北2/北京）

## 安装

1. 下载 [`src/xhs-to-obsidian.js`](src/xhs-to-obsidian.js)。
2. 在 Scriptable 中新建脚本，命名为“小红书解析”，粘贴完整代码。
3. 新建 Apple 快捷指令，添加 `Scriptable -> Run Script`，选择“小红书解析”。
4. 开启 `Run In App`，首次运行时允许读取剪贴板。
5. 首次运行输入一个阿里云百炼 API Key，不要把 Key 写进脚本。

处理超过 10 分钟的视频时，脚本会询问该 Key 对应的业务空间专属 API Host，通常形如 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com`。

## 输出

默认写入：

```text
00_Inbox 收集箱/来源-小红书/笔记标题.md
```

笔记包含原链接、小红书原文、结构化摘要、核心要点、标签和折叠的完整识别原文。视频识别原文会注明实际使用的免费额度模型。

## 本地测试

```bash
node tests/parser.test.mjs
```

## 限制与隐私

- 千问会接收图片 URL、视频 URL、标题、原文和识别内容，用于生成识别结果与摘要。
- API Key 通过 Scriptable Keychain 保存在本机，不会写入 Markdown 或仓库。
- 小红书 CDN URL 可能过期，建议及时运行脚本。
- OCR、字幕与视频理解可能出错，政策、金额、日期等信息应回看原内容和官方来源。
- 处理期间请保持 Scriptable 在前台，长视频处理时不要锁屏。
- 仅处理你有权访问和摘录的内容，并遵守小红书、阿里云百炼和 Obsidian 的条款。

## 免责声明

本项目与小红书、阿里云百炼、Scriptable 或 Obsidian 无隶属关系。

## License

[MIT](LICENSE)
