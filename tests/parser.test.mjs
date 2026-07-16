import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const skillScript = new URL("../scripts/xhs-to-obsidian.js", import.meta.url);
const repoScript = new URL("../src/xhs-to-obsidian.js", import.meta.url);
const source = fs.readFileSync(fs.existsSync(skillScript) ? skillScript : repoScript, "utf8");
const executable = source.slice(0, source.indexOf("\ntry {\n  await main();"));
const context = { console, Date, JSON, RegExp, Set, String, Math };

assert.match(source, /^\/\/ XHS to Obsidian for Scriptable v1\.6\.0/);
assert.match(source, /const VISION_MODEL = "qwen3\.7-plus"/);
assert.match(source, /const SUMMARY_MODEL = "qwen3\.7-plus"/);
assert.match(source, /qwen3\.5-omni-plus-2026-03-15/);
assert.match(source, /qwen2\.5-omni-7b/);
assert.doesNotMatch(source, /const VIDEO_MODEL =/);
assert.doesNotMatch(source, /GROQ_KEY_NAME|gsk_|api\.groq\.com|DEEPSEEK_KEY_NAME|api\.deepseek\.com/);

vm.runInNewContext(`${executable}\nglobalThis.testApi = {\n  extractXhsUrl,\n  readNoteId,\n  getNoteScope,\n  readJsonString,\n  readVideoMetadata,\n  readImageUrls,\n  buildMarkdown,\n  buildNoteFilePath,\n  parseRetryDelayMs,\n  parseQwenStreamText,\n  formatSrtTranscript,\n  videoOutputTokenLimit,\n  normalizeDashscopeBaseUrl,\n  isWorkspaceDedicatedBaseUrl,\n  splitTextByLength,\n  buildSummaryFallback,\n};`, context);

const { testApi } = context;
const modelPoolTest = vm.runInNewContext(`${executable}\n({
  short: orderedVideoModels(30, 0).map(model => model.id),
  medium: orderedVideoModels(120, 0).map(model => model.id),
  long: orderedVideoModels(1200, 0).map(model => model.id),
  unknown: orderedVideoModels(0, 0).map(model => model.id),
  rotated: orderedVideoModels(30, 10).map(model => model.id),
  quotaExhausted: isFreeQuotaExhausted(403, { error: { code: "AllocationQuota.FreeTierOnly" } }),
})`, { console, Date, JSON, RegExp, Set, String, Math });
assert.equal(modelPoolTest.short.length, 11);
assert.equal(modelPoolTest.medium.length, 6);
assert.equal(modelPoolTest.long.length, 3);
assert.equal(modelPoolTest.unknown.length, 3);
assert.equal(modelPoolTest.rotated[0], "qwen2.5-omni-7b");
assert.ok(modelPoolTest.short.every(model => !model.includes("realtime")));
assert.equal(modelPoolTest.quotaExhausted, true);

const noteId = "6a50b7eb00000000170090f1";
const imageUrl = "http://sns-webpic-qc.xhscdn.com/example/image.webp";
const note = {
  title: "7月公积金调整",
  desc: "基数加了5k，舒服了",
  noteId,
  type: "normal",
  imageList: [{
    infoList: [{ imageScene: "WB_DFT", url: imageUrl }],
    urlDefault: imageUrl,
    width: 1200,
    height: 1600,
  }],
};
const html = `<script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"${noteId}":{"note":${JSON.stringify(note)}}}}}</script>`;

assert.equal(testApi.readNoteId(`https://www.xiaohongshu.com/discovery/item/${noteId}?source=webshare`), noteId);
assert.equal(testApi.extractXhsUrl(`看看这条 https://www.xiaohongshu.com/discovery/item/${noteId}?source=webshare。`), `https://www.xiaohongshu.com/discovery/item/${noteId}?source=webshare`);

const scope = testApi.getNoteScope(html, noteId);
assert.equal(testApi.readJsonString(scope, "title"), note.title);
assert.equal(testApi.readJsonString(scope, "desc"), note.desc);
assert.deepEqual([...testApi.readImageUrls(scope, html)], [imageUrl.replace("http:", "https:")]);

const mediaV2 = JSON.stringify({
  video: {
    duration: 1866,
    subtitles: {
      "zh-CN": [{ url: "http://sns-subtitle-s2.xhscdn.com/example.srt" }],
    },
  },
});
assert.deepEqual(
  { ...testApi.readVideoMetadata(JSON.stringify({ mediaV2 })) },
  {
    durationSeconds: 1866,
    subtitleUrl: "https://sns-subtitle-s2.xhscdn.com/example.srt",
  },
);

const markdown = testApi.buildMarkdown({
  title: note.title,
  desc: note.desc,
  type: "image",
  sourceUrl: `https://www.xiaohongshu.com/discovery/item/${noteId}`,
  imageUrls: [imageUrl.replace("http:", "https:")],
}, "", "### 图片 1\n公积金基数调整", "## 内容摘要\n摘要");

assert.match(markdown, /content_type: image/);
assert.match(markdown, /region: CN/);
assert.match(markdown, /captured: \d{4}-\d{2}-\d{2}\n/);
assert.doesNotMatch(markdown, /captured: .*T/);
assert.match(markdown, /\ntags:\n  - 小红书摘录-CN\n/);
assert.match(markdown, /# 7月公积金调整-CN/);
assert.match(markdown, /!\[小红书图片 1\]\(https:\/\/sns-webpic-qc\.xhscdn\.com/);
assert.match(markdown, /<summary>图片识别原文<\/summary>/);
assert.doesNotMatch(markdown, /视频转写原文/);
assert.equal(
  testApi.buildNoteFilePath("这玩意真直接把视频搬运号的饭碗给掀了"),
  "00_Inbox 收集箱/来源-小红书/这玩意真直接把视频搬运号的饭碗给掀了-CN.md",
);
assert.equal(
  testApi.buildNoteFilePath("AI 产品验收标准-CN"),
  "00_Inbox 收集箱/来源-小红书/AI 产品验收标准-CN.md",
);
assert.match(testApi.buildNoteFilePath("超长标题".repeat(20)), /-CN\.md$/);
assert.equal(
  testApi.parseRetryDelayMs({ error: { message: "Please try again in 1.595s" } }, 1),
  2595,
);
assert.equal(testApi.parseRetryDelayMs({}, 2), 10000);

const videoMarkdown = testApi.buildMarkdown({
  title: "AI 产品验收标准",
  desc: "视频笔记",
  type: "video",
  sourceUrl: `https://www.xiaohongshu.com/discovery/item/${noteId}`,
  imageUrls: [],
}, "## 视频逐字转写\n你好\n\n## 画面与字幕信息\n演示画面", "", "## 内容摘要\n摘要");
assert.match(videoMarkdown, /<summary>视频识别原文<\/summary>/);
assert.doesNotMatch(videoMarkdown, /视频转写原文/);

const streamResponse = [
  'data: {"choices":[{"delta":{"content":"你好"}}]}',
  'data: {"choices":[{"delta":{"content":"世界"}}]}',
  "data: [DONE]",
].join("\n\n");
assert.equal(testApi.parseQwenStreamText(streamResponse), "你好世界");

const srt = [
  "1\n00:00:01,200 --> 00:00:03,000\n大家好",
  "2\n00:01:04,500 --> 00:01:08,000\n<b>开始演示</b>",
].join("\n\n");
assert.equal(
  testApi.formatSrtTranscript(srt),
  "[00:00:01.200] 大家好\n[00:01:04.500] 开始演示",
);
assert.equal(testApi.videoOutputTokenLimit(500), 8192);
assert.equal(testApi.videoOutputTokenLimit(1200), 16384);
assert.equal(testApi.videoOutputTokenLimit(1866), 32768);
assert.equal(
  testApi.normalizeDashscopeBaseUrl("https://workspace.cn-beijing.maas.aliyuncs.com/"),
  "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
);
assert.equal(
  testApi.isWorkspaceDedicatedBaseUrl("https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"),
  true,
);
assert.equal(testApi.isWorkspaceDedicatedBaseUrl("https://dashscope.aliyuncs.com/compatible-mode/v1"), false);

const longText = ["第一段内容", "第二段内容比较长", "第三段内容"].join("\n");
const chunks = [...testApi.splitTextByLength(longText, 12)];
assert.ok(chunks.length > 1);
assert.equal(chunks.join("\n"), longText);
const fallbackSummary = testApi.buildSummaryFallback(new Error("网络连接已中断"));
assert.match(fallbackSummary, /识别原文已经保留下来/);
assert.match(fallbackSummary, /网络连接已中断/);
assert.match(fallbackSummary, /#待总结-CN/);

console.log("parser tests passed");
