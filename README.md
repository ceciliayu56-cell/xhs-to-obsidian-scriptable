# XHS to Obsidian CN for Scriptable

一套在 iPhone/iPad 上运行的小红书图文与视频摘录流程：解析分享链接，用阿里云百炼千问识别图片、视频画面、字幕和声音，生成结构化摘要，再写入 Obsidian。

## 主要功能

- 从剪贴板提取 `xhslink.com` 或 `xiaohongshu.com` 链接。
- 自动识别图文或视频笔记。
- Qwen大模型负责图片 OCR、画面理解和结构化总结。
- 视频完整理解失败时，如果小红书提供中文字幕，自动使用字幕继续整理。

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
00_Inbox 收集箱/来源-小红书/笔记标题-CN.md
```

笔记包含原链接、小红书原文、结构化摘要、核心要点、标签和折叠的完整识别原文。视频识别原文会注明实际使用的免费额度模型。

## 本地测试

```bash
node tests/parser.test.mjs
```

## 限制与隐私

- 小红书 CDN URL 可能过期，建议及时运行脚本。
- OCR、字幕与视频理解可能出错，政策、金额、日期等信息应回看原内容和官方来源。
- 仅处理你有权访问和摘录的内容，并遵守小红书、阿里云百炼和 Obsidian 的条款。

## License

[MIT](LICENSE)
