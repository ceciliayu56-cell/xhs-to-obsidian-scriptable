// XHS to Obsidian for Scriptable v1.1.0
// 小红书图文/视频解析 -> DeepSeek 总结 -> Obsidian

const GROQ_KEY_NAME = "xhs_obsidian_groq_api_key";
const DEEPSEEK_KEY_NAME = "xhs_obsidian_deepseek_api_key";
const TRANSCRIBE_MODEL = "whisper-large-v3-turbo";
const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const SUMMARY_MODEL = "deepseek-v4-flash";
const MAX_VIDEO_BYTES = 24 * 1024 * 1024;
const MAX_IMAGES_PER_REQUEST = 5;
let currentStage = "准备运行";

async function main() {
  currentStage = "读取剪贴板";
  const sharedText = Pasteboard.pasteString();
  if (!sharedText || !sharedText.trim()) {
    throw new Error("剪贴板为空，请先复制小红书分享内容");
  }

  const sourceUrl = extractXhsUrl(sharedText);
  if (!sourceUrl) {
    throw new Error("剪贴板中没有找到小红书链接");
  }

  const deepSeekKey = await getApiKey(DEEPSEEK_KEY_NAME, "DeepSeek", "sk-...");
  currentStage = "读取小红书页面";
  const note = await fetchXhsNote(sourceUrl);
  await showStartNotice(note.type);

  const groqKey = await getApiKey(GROQ_KEY_NAME, "Groq", "gsk_...");
  currentStage = "检查 Groq 网络和 API Key";
  await checkGroq(groqKey);

  let transcript = "";
  let imageContent = "";
  if (note.type === "video") {
    currentStage = "等待 Groq 转写视频";
    transcript = await transcribeVideo(note.videoUrl, groqKey);
  } else {
    currentStage = "等待 Groq 识别图片内容";
    imageContent = await readImagesWithGroq(note.imageUrls, groqKey);
  }
  currentStage = "等待 DeepSeek 生成结构化摘要";
  const summary = await summarizeNote(note, transcript, imageContent, deepSeekKey);
  const markdown = buildMarkdown(note, transcript, imageContent, summary);

  currentStage = "打开 Obsidian";
  Pasteboard.copyString(markdown);
  openInObsidian(note.title);
}

async function checkGroq(apiKey) {
  const request = new Request("https://api.groq.com/openai/v1/models");
  request.method = "GET";
  request.timeoutInterval = 20;
  request.headers = { Authorization: `Bearer ${apiKey}` };
  const result = await request.loadJSON();
  ensureSuccess(request, "Groq 连接测试", result, GROQ_KEY_NAME);
}

function extractXhsUrl(text) {
  const match = text.match(/https?:\/\/(?:www\.)?(?:xhslink\.com|xiaohongshu\.com)\/[^\s，。]+/i);
  return match
    ? match[0].replace(/[)）\]】,，。.!！]+$/, "").replace(/^http:/, "https:")
    : null;
}

async function fetchXhsNote(url) {
  const request = new Request(url);
  request.timeoutInterval = 60;
  request.headers = mobileHeaders();
  const html = await request.loadString();
  ensureSuccess(request, "读取小红书页面");

  const finalUrl = request.response && request.response.url ? request.response.url : url;
  const noteId = readNoteId(finalUrl);
  const noteText = getNoteScope(html, noteId);
  const title = readJsonString(noteText, "title") || readLdJson(html)?.headline?.replace(/\s*-\s*小红书$/, "") || "小红书摘录";
  const desc = readJsonString(noteText, "desc") || readLdJson(html)?.description || "";
  const rawVideoUrl = readJsonString(noteText, "masterUrl");
  const videoUrl = rawVideoUrl ? normalizeMediaUrl(rawVideoUrl) : "";
  const imageUrls = readImageUrls(noteText, html);
  const type = videoUrl ? "video" : imageUrls.length ? "image" : "";

  if (!type) {
    throw new Error("页面中没有找到视频或图片，可能需要重新复制分享链接，或小红书页面结构已变化");
  }

  return {
    title,
    desc,
    type,
    videoUrl,
    imageUrls,
    sourceUrl: finalUrl,
  };
}

function readNoteId(url) {
  const match = url.match(/\/(?:item|explore)\/([a-z0-9]+)/i);
  return match ? match[1] : "";
}

function getNoteScope(html, noteId) {
  if (!noteId) return html;
  const anchor = `"noteDetailMap":{"${noteId}":`;
  const start = html.indexOf(anchor);
  return start >= 0 ? html.slice(start, start + 500000) : html;
}

function readJsonString(text, key) {
  const pattern = new RegExp(`"${key}":"((?:\\\\.|[^"\\\\])*)"`);
  const match = text.match(pattern);
  if (!match) return "";
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch (_) {
    return match[1].replace(/\\u002F/g, "/").replace(/\\n/g, "\n");
  }
}

function readImageUrls(noteText, html) {
  const imageList = readJsonArray(noteText, "imageList");
  const urls = imageList.map(image => {
    const defaultInfo = Array.isArray(image.infoList)
      ? image.infoList.find(item => item.imageScene === "WB_DFT")
      : null;
    return image.urlDefault || defaultInfo?.url || image.urlPre || image.url || "";
  }).filter(Boolean).map(normalizeMediaUrl);

  if (urls.length) return [...new Set(urls)];

  const ldJson = readLdJson(html);
  const fallback = Array.isArray(ldJson?.image) ? ldJson.image : ldJson?.image ? [ldJson.image] : [];
  return [...new Set(fallback.filter(Boolean).map(normalizeMediaUrl))];
}

function readJsonArray(text, key) {
  const marker = `"${key}":`;
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return [];
  const start = text.indexOf("[", markerIndex + marker.length);
  if (start < 0) return [];
  const raw = readBalancedJson(text, start, "[", "]");
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch (_) {
    return [];
  }
}

function readBalancedJson(text, start, open, close) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth++;
    else if (char === close && --depth === 0) return text.slice(start, index + 1);
  }
  return "";
}

function readLdJson(html) {
  const matches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of matches) {
    try {
      const value = JSON.parse(match[1]);
      if (value && (value.headline || value.description || value.image)) return value;
    } catch (_) {}
  }
  return null;
}

function normalizeMediaUrl(url) {
  return String(url).replace(/^http:/, "https:");
}

async function transcribeVideo(videoUrl, apiKey) {
  currentStage = "由 iPhone 下载小红书视频";
  const videoRequest = new Request(videoUrl);
  videoRequest.timeoutInterval = 180;
  videoRequest.headers = mobileHeaders();
  const videoData = await videoRequest.load();
  ensureSuccess(videoRequest, "iPhone 下载视频");

  if (videoData.length > MAX_VIDEO_BYTES) {
    throw new Error(`视频约 ${Math.ceil(videoData.length / 1024 / 1024)} MB，超过 Groq 免费层的安全上传限制`);
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    currentStage = attempt === 1
      ? "由 iPhone 上传视频并等待 Groq 转写"
      : "重新上传视频并等待 Groq 转写";
    try {
      return await transcribeVideoData(videoData, apiKey);
    } catch (error) {
      if (attempt === 2 || /API Key|401|429|rate limit|quota/i.test(String(error.message || error))) {
        throw error;
      }
    }
  }
}

async function transcribeVideoData(videoData, apiKey) {
  const request = new Request("https://api.groq.com/openai/v1/audio/transcriptions");
  request.method = "POST";
  request.timeoutInterval = 300;
  request.headers = { Authorization: `Bearer ${apiKey}` };
  request.addFileDataToMultipart(videoData, "video/mp4", "file", "video.mp4");
  request.addParameterToMultipart("model", TRANSCRIBE_MODEL);
  request.addParameterToMultipart("language", "zh");
  request.addParameterToMultipart("response_format", "json");
  const result = await request.loadJSON();
  ensureSuccess(request, "Groq 视频上传转写", result, GROQ_KEY_NAME);
  if (!result.text || !result.text.trim()) throw new Error("视频转写结果为空");
  return result.text.trim();
}

async function readImagesWithGroq(imageUrls, apiKey) {
  const results = [];
  for (let start = 0; start < imageUrls.length; start += MAX_IMAGES_PER_REQUEST) {
    const batch = imageUrls.slice(start, start + MAX_IMAGES_PER_REQUEST);
    currentStage = `等待 Groq 识别图片 ${start + 1}-${start + batch.length}`;
    const content = [{
      type: "text",
      text: `请按顺序读取这 ${batch.length} 张小红书笔记图片。逐张输出“### 图片 N”，N 从 ${start + 1} 开始。完整抄录可辨识的中文、数字、表格和关键标注，再简要描述与文字理解相关的画面信息。看不清的地方标注“无法辨识”，不要猜测。`,
    }];
    batch.forEach(url => content.push({ type: "image_url", image_url: { url } }));

    const request = new Request("https://api.groq.com/openai/v1/chat/completions");
    request.method = "POST";
    request.timeoutInterval = 240;
    request.headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    request.body = JSON.stringify({
      model: VISION_MODEL,
      temperature: 0.1,
      max_completion_tokens: 4096,
      messages: [{ role: "user", content }],
    });
    const result = await request.loadJSON();
    ensureSuccess(request, "Groq 图片识别", result, GROQ_KEY_NAME);
    const text = result.choices?.[0]?.message?.content;
    if (!text || !text.trim()) throw new Error("Groq 图片识别结果为空");
    results.push(text.trim());
  }
  return results.join("\n\n");
}

async function summarizeNote(note, transcript, imageContent, apiKey) {
  const material = note.type === "video"
    ? `视频转写：${transcript}`
    : `笔记类型：图文\n图片数量：${note.imageUrls.length}\n图片识别内容：\n${imageContent}`;
  const sections = note.type === "video"
    ? "“## 内容摘要”“## 视频内容”“## 核心要点”“## 标签”四个部分"
    : "“## 内容摘要”“## 核心要点”“## 标签”三个部分";
  const prompt = `请根据以下小红书笔记信息生成结构化 Markdown 摘要。\n\n标题：${note.title}\n原文：${note.desc || "无"}\n${material}\n\n要求：\n1. 只依据材料，不要猜测或编造。图片识别内容可能有误，遇到矛盾或无法辨识的信息要明确说明。\n2. 输出${sections}。\n3. 内容摘要用一段话；核心要点使用列表；标签输出 3-8 个 Obsidian 标签。\n4. 涉及金额、比例、日期、政策条件时保留原始数值，并提醒读者以当地官方口径为准。\n5. 不要重复输出一级标题和来源链接。`;

  const request = new Request("https://api.deepseek.com/chat/completions");
  request.method = "POST";
  request.timeoutInterval = 180;
  request.headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  request.body = JSON.stringify({
    model: SUMMARY_MODEL,
    temperature: 0.2,
    thinking: { type: "disabled" },
    stream: false,
    messages: [
      { role: "system", content: "你是严谨的中文内容整理助手。" },
      { role: "user", content: prompt },
    ],
  });

  const result = await request.loadJSON();
  ensureSuccess(request, "DeepSeek 生成摘要", result, DEEPSEEK_KEY_NAME);
  const content = result.choices?.[0]?.message?.content;
  if (!content) throw new Error("摘要接口没有返回正文");
  return content.trim();
}

function buildMarkdown(note, transcript, imageContent, summary) {
  const now = new Date();
  const captured = now.toISOString();
  const images = note.imageUrls.length
    ? `\n\n## 笔记图片\n\n${note.imageUrls.map((url, index) => `![小红书图片 ${index + 1}](${url})`).join("\n\n")}`
    : "";
  const transcriptBlock = transcript
    ? `\n\n<details>\n<summary>视频转写原文</summary>\n\n${transcript}\n\n</details>`
    : "";
  const imageContentBlock = imageContent
    ? `\n\n<details>\n<summary>图片识别原文</summary>\n\n${imageContent}\n\n</details>`
    : "";
  return `---\nsource: "${note.sourceUrl.replace(/"/g, '\\"')}"\nplatform: xiaohongshu\ncontent_type: ${note.type}\ncaptured: ${captured}\ntags:\n  - 小红书摘录\n---\n\n# ${note.title}\n\n> [查看原笔记](${note.sourceUrl})\n\n## 笔记原文\n\n${note.desc || "（原笔记没有文字说明）"}${images}\n\n${summary}${transcriptBlock}${imageContentBlock}\n`;
}

function openInObsidian(title) {
  const stamp = formatDate(new Date());
  const safeTitle = title.replace(/[\\/:*?"<>|#[\]^]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  const file = `Inbox/${stamp}-${safeTitle || "小红书摘录"}.md`;
  Safari.open(`obsidian://new?file=${encodeURIComponent(file)}&clipboard=true`);
}

function formatDate(date) {
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function mobileHeaders() {
  return {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    "Accept-Language": "zh-CN,zh-Hans;q=0.9",
  };
}

function ensureSuccess(request, label, body = null, keyName = null) {
  const status = request.response ? request.response.statusCode : 0;
  if (status >= 200 && status < 300) return;
  const detail = body?.error?.message || body?.message || `HTTP ${status || "未知"}`;
  if (status === 401 && keyName) {
    if (Keychain.contains(keyName)) Keychain.remove(keyName);
    throw new Error(`${label}失败：API Key 无效，已自动清除，请重新运行后输入正确的 Key`);
  }
  throw new Error(`${label}失败：${detail}`);
}

async function getApiKey(keyName, provider, placeholder) {
  if (Keychain.contains(keyName)) return Keychain.get(keyName);

  const alert = new Alert();
  alert.title = `设置 ${provider} API Key`;
  alert.message = "Key 只保存在当前 iPhone 的 Scriptable Keychain 中。";
  alert.addSecureTextField(placeholder, "");
  alert.addAction("保存");
  alert.addCancelAction("取消");
  const choice = await alert.present();
  if (choice < 0) throw new Error("已取消设置 API Key");
  const key = alert.textFieldValue(0).trim();
  if (!key) throw new Error("API Key 不能为空");
  Keychain.set(keyName, key);
  return key;
}

async function showStartNotice(type) {
  const alert = new Alert();
  alert.title = "开始处理";
  alert.message = type === "video"
    ? "已识别为视频笔记。iPhone 将下载视频，Groq 转写后由 DeepSeek 生成摘要，通常需要 20 秒到 1 分钟。"
    : "已识别为图文笔记。Groq 将分批读取图片文字和画面信息，再由 DeepSeek 生成摘要，通常需要 20 秒到 1 分钟。";
  alert.addAction("继续");
  alert.addCancelAction("取消");
  const choice = await alert.present();
  if (choice < 0) throw new Error("用户取消处理");
}

try {
  await main();
} catch (error) {
  const alert = new Alert();
  alert.title = "小红书解析失败";
  alert.message = `${currentStage}：${String(error.message || error)}`;
  alert.addAction("好");
  await alert.present();
}

Script.complete();
