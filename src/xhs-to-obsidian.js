// XHS to Obsidian for Scriptable v1.0.0
// 小红书视频解析 -> Groq 转写 -> DeepSeek 总结 -> Obsidian

const GROQ_KEY_NAME = "xhs_obsidian_groq_api_key";
const DEEPSEEK_KEY_NAME = "xhs_obsidian_deepseek_api_key";
const TRANSCRIBE_MODEL = "whisper-large-v3-turbo";
const SUMMARY_MODEL = "deepseek-v4-flash";
const MAX_VIDEO_BYTES = 24 * 1024 * 1024;
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

  const groqKey = await getApiKey(GROQ_KEY_NAME, "Groq", "gsk_...");
  const deepSeekKey = await getApiKey(DEEPSEEK_KEY_NAME, "DeepSeek", "sk-...");
  await showStartNotice();
  currentStage = "检查 Groq 网络和 API Key";
  await checkGroq(groqKey);

  currentStage = "读取小红书页面";
  const note = await fetchXhsNote(sourceUrl);

  currentStage = "等待 Groq 转写视频";
  const transcript = await transcribeVideo(note.videoUrl, groqKey);
  currentStage = "等待 DeepSeek 生成结构化摘要";
  const summary = await summarizeNote(note, transcript, deepSeekKey);
  const markdown = buildMarkdown(note, transcript, summary);

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

  const title = readJsonString(html, "title") || "小红书视频摘录";
  const desc = readJsonString(html, "desc");
  let videoUrl = readJsonString(html, "masterUrl");
  if (!videoUrl) throw new Error("页面中没有找到视频地址，可能是图文笔记或页面结构已变化");
  videoUrl = videoUrl.replace(/^http:/, "https:");

  return {
    title,
    desc,
    videoUrl,
    sourceUrl: request.response && request.response.url ? request.response.url : url,
  };
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

async function summarizeNote(note, transcript, apiKey) {
  const prompt = `请根据以下小红书笔记信息生成结构化 Markdown 摘要。\n\n标题：${note.title}\n原文：${note.desc || "无"}\n视频转写：${transcript}\n\n要求：\n1. 只依据材料，不要编造。\n2. 输出“## 内容摘要”“## 视频内容”“## 核心要点”“## 标签”四个部分。\n3. 内容摘要用一段话；视频内容按叙述顺序整理；核心要点使用列表；标签输出 3-8 个 Obsidian 标签。\n4. 不要重复输出一级标题和来源链接。`;

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

function buildMarkdown(note, transcript, summary) {
  const now = new Date();
  const captured = now.toISOString();
  return `---\nsource: "${note.sourceUrl.replace(/"/g, '\\"')}"\nplatform: xiaohongshu\ncaptured: ${captured}\ntags:\n  - 小红书摘录\n---\n\n# ${note.title}\n\n> [查看原笔记](${note.sourceUrl})\n\n## 笔记原文\n\n${note.desc || "（原笔记没有文字说明）"}\n\n${summary}\n\n<details>\n<summary>视频转写原文</summary>\n\n${transcript}\n\n</details>\n`;
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

async function showStartNotice() {
  const alert = new Alert();
  alert.title = "开始处理";
  alert.message = "Groq 将直接读取视频地址并转写，DeepSeek 随后生成摘要，通常需要 20 秒到 1 分钟。";
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
