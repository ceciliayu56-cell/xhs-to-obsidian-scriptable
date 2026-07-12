import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const skillScript = new URL("../scripts/xhs-to-obsidian.js", import.meta.url);
const repoScript = new URL("../src/xhs-to-obsidian.js", import.meta.url);
const source = fs.readFileSync(fs.existsSync(skillScript) ? skillScript : repoScript, "utf8");
const executable = source.slice(0, source.indexOf("\ntry {\n  await main();"));
const context = { console, Date, JSON, RegExp, Set, String, Math };

vm.runInNewContext(`${executable}\nglobalThis.testApi = {\n  extractXhsUrl,\n  readNoteId,\n  getNoteScope,\n  readJsonString,\n  readImageUrls,\n  buildMarkdown,\n};`, context);

const { testApi } = context;
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

const markdown = testApi.buildMarkdown({
  title: note.title,
  desc: note.desc,
  type: "image",
  sourceUrl: `https://www.xiaohongshu.com/discovery/item/${noteId}`,
  imageUrls: [imageUrl.replace("http:", "https:")],
}, "", "### 图片 1\n公积金基数调整", "## 内容摘要\n摘要");

assert.match(markdown, /content_type: image/);
assert.match(markdown, /!\[小红书图片 1\]\(https:\/\/sns-webpic-qc\.xhscdn\.com/);
assert.match(markdown, /<summary>图片识别原文<\/summary>/);
assert.doesNotMatch(markdown, /视频转写原文/);

console.log("parser tests passed");
