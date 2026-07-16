// XHS to Obsidian- CN for Scriptable v1.6.1
// 小红书图文/视频解析 -> 千问识别与总结 -> Obsidian

const DASHSCOPE_KEY_NAME = "xhs_obsidian_dashscope_api_key";
const DASHSCOPE_BASE_URL_NAME = "xhs_obsidian_dashscope_base_url";
const VIDEO_MODEL_CURSOR_NAME = "xhs_obsidian_qwen_video_model_cursor";
const VISION_MODEL = "qwen3.7-plus";
const SUMMARY_MODEL = "qwen3.7-plus";
// 2026-07-16 百炼中国内地控制台中有免费额度、且支持 HTTP 视频输入的模型。
// Realtime 模型需要 WebSocket，不适用于当前 Scriptable HTTP 流程。
const VIDEO_MODEL_POOL = [
  { id: "qwen3.5-omni-plus-2026-03-15", maxSeconds: 3600, maxTokens: 32768 },
  { id: "qwen3.5-omni-plus", maxSeconds: 3600, maxTokens: 32768 },
  { id: "qwen3.5-omni-flash-2026-03-15", maxSeconds: 3600, maxTokens: 32768 },
  { id: "qwen3-omni-flash", maxSeconds: 150, maxTokens: 8192 },
  { id: "qwen3-omni-flash-2025-12-01", maxSeconds: 150, maxTokens: 8192 },
  { id: "qwen3-omni-flash-2025-09-15", maxSeconds: 150, maxTokens: 8192 },
  { id: "qwen-omni-turbo-latest", maxSeconds: 40, maxTokens: 2048 },
  { id: "qwen-omni-turbo", maxSeconds: 40, maxTokens: 2048 },
  { id: "qwen-omni-turbo-2025-03-26", maxSeconds: 40, maxTokens: 2048 },
  { id: "qwen-omni-turbo-2025-01-19", maxSeconds: 40, maxTokens: 2048 },
  { id: "qwen2.5-omni-7b", maxSeconds: 40, maxTokens: 2048 },
];
const DEFAULT_DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const LONG_VIDEO_SECONDS = 600;
const SUMMARY_CHUNK_CHARS = 9000;
const MAX_IMAGES_PER_REQUEST = 5;
const MAX_API_ATTEMPTS = 3;
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

  currentStage = "读取小红书页面";
  const note = await fetchXhsNote(sourceUrl);
  await showStartNotice(note);

  const dashscopeKey = await getApiKey(DASHSCOPE_KEY_NAME, "阿里云百炼（千问）", "sk-ws-...");
  const dashscopeBaseUrl = await getDashscopeBaseUrl(
    note.type === "video" && note.durationSeconds > LONG_VIDEO_SECONDS,
    note.durationSeconds,
  );
  let videoContent = "";
  let imageContent = "";
  if (note.type === "video") {
    currentStage = "等待千问理解视频画面和声音";
    try {
      videoContent = await readVideoWithQwen(
        note.videoUrl,
        note.durationSeconds,
        dashscopeKey,
        dashscopeBaseUrl,
      );
    } catch (error) {
      if (!note.subtitleUrl) throw error;
      currentStage = "千问完整视频解析未完成，读取小红书中文字幕兜底";
      videoContent = await readXhsSubtitle(note.subtitleUrl, error);
    }
  } else {
    currentStage = "等待千问识别图片内容";
    imageContent = await readImagesWithQwen(note.imageUrls, dashscopeKey, dashscopeBaseUrl);
  }
  currentStage = "等待千问生成结构化摘要";
  let summary = "";
  try {
    summary = await summarizeNote(note, videoContent, imageContent, dashscopeKey, dashscopeBaseUrl);
  } catch (error) {
    summary = buildSummaryFallback(error);
  }
  const markdown = buildMarkdown(note, videoContent, imageContent, summary);

  currentStage = "打开 Obsidian";
  Pasteboard.copyString(markdown);
  openInObsidian(note.title);
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
  const videoMetadata = readVideoMetadata(noteText);
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
    durationSeconds: videoMetadata.durationSeconds,
    subtitleUrl: videoMetadata.subtitleUrl,
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

function readVideoMetadata(noteText) {
  const rawMedia = readJsonString(noteText, "mediaV2");
  if (!rawMedia) return { durationSeconds: 0, subtitleUrl: "" };

  try {
    const media = JSON.parse(rawMedia);
    const durationSeconds = Number(media?.video?.duration) || 0;
    const subtitles = media?.video?.subtitles || {};
    const preferred = subtitles["zh-CN"]?.[0]
      || subtitles.source?.[0]
      || Object.values(subtitles).flat().find(Boolean);
    return {
      durationSeconds,
      subtitleUrl: preferred?.url ? normalizeMediaUrl(preferred.url) : "",
    };
  } catch (_) {
    return { durationSeconds: 0, subtitleUrl: "" };
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

async function readVideoWithQwen(videoUrl, durationSeconds, apiKey, baseUrl) {
  const content = [
    {
      type: "video_url",
      video_url: { url: videoUrl },
    },
    {
      type: "text",
      text: "请同时理解这条小红书视频的画面、屏幕字幕、人物口播和其他重要声音。按顺序输出“## 视频逐字转写”和“## 画面与字幕信息”。尽可能完整转写可辨识的口播和对话，并按关键时间段描述画面、抄录重要字幕。无法辨识的地方明确标注，不要猜测。",
    },
  ];
  return loadQwenVideoWithRetry(content, durationSeconds, apiKey, baseUrl);
}

async function loadQwenVideoWithRetry(content, durationSeconds, apiKey, baseUrl) {
  const models = orderedVideoModels(durationSeconds, readVideoModelCursor());
  if (!models.length) {
    throw new Error("没有适配当前视频时长的千问免费额度模型");
  }
  const failures = [];

  for (const model of models) {
    const stageLabel = `千问 ${model.id} 识别视频`;
    for (let attempt = 1; attempt <= MAX_API_ATTEMPTS; attempt++) {
      currentStage = `${stageLabel}（免费额度模型 ${models.indexOf(model) + 1}/${models.length}）`;
      const request = new Request(`${baseUrl}/chat/completions`);
      request.method = "POST";
      request.timeoutInterval = 3600;
      request.headers = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      };
      request.body = JSON.stringify({
        model: model.id,
        max_tokens: Math.min(videoOutputTokenLimit(durationSeconds), model.maxTokens),
        stream: true,
        stream_options: { include_usage: true },
        modalities: ["text"],
        messages: [{ role: "user", content }],
      });

      const responseText = await request.loadString();
      const result = parseJsonResponse(responseText);
      const status = request.response ? request.response.statusCode : 0;
      if ((status === 429 || status >= 500) && attempt < MAX_API_ATTEMPTS) {
        const waitMs = parseRetryDelayMs(result, attempt);
        currentStage = `${stageLabel}暂时不可用，${Math.ceil(waitMs / 1000)} 秒后自动重试`;
        await sleep(waitMs);
        continue;
      }

      if (status >= 200 && status < 300) {
        const text = parseQwenStreamText(responseText);
        if (text) {
          advanceVideoModelCursor(model.id);
          return `> 本次视频识别模型：${model.id}（百炼免费额度轮转）\n\n${text}`;
        }
        failures.push(`${model.id}：返回内容为空`);
        break;
      }

      const detail = apiErrorDetail(result, status);
      if (isFreeQuotaExhausted(status, result)) {
        failures.push(`${model.id}：免费额度已用尽`);
        currentStage = `${model.id} 免费额度已用尽，自动切换下一个模型`;
        break;
      }
      if (isSwitchableVideoModelError(status, result)) {
        failures.push(`${model.id}：${detail}`);
        currentStage = `${model.id} 不适用或暂时不可用，自动切换下一个模型`;
        break;
      }

      ensureSuccess(request, stageLabel, result, DASHSCOPE_KEY_NAME);
    }
  }

  const recentFailures = failures.slice(-4).join("；");
  throw new Error(`所有适配视频时长的千问免费额度模型都未完成识别。${recentFailures}`);
}

function orderedVideoModels(durationSeconds, cursorIndex = 0) {
  const duration = Number(durationSeconds) || 0;
  const normalizedCursor = ((Number(cursorIndex) || 0) % VIDEO_MODEL_POOL.length + VIDEO_MODEL_POOL.length) % VIDEO_MODEL_POOL.length;
  const rotated = VIDEO_MODEL_POOL.slice(normalizedCursor).concat(VIDEO_MODEL_POOL.slice(0, normalizedCursor));
  return rotated.filter(model => duration > 0 ? duration <= model.maxSeconds : model.maxSeconds >= 3600);
}

function readVideoModelCursor() {
  if (!Keychain.contains(VIDEO_MODEL_CURSOR_NAME)) return 0;
  const value = Number(Keychain.get(VIDEO_MODEL_CURSOR_NAME));
  return Number.isFinite(value) ? value : 0;
}

function advanceVideoModelCursor(modelId) {
  const index = VIDEO_MODEL_POOL.findIndex(model => model.id === modelId);
  if (index >= 0) Keychain.set(VIDEO_MODEL_CURSOR_NAME, String((index + 1) % VIDEO_MODEL_POOL.length));
}

function apiErrorDetail(result, status) {
  return String(result?.error?.message || result?.message || result?.error?.code || result?.code || `HTTP ${status || "未知"}`)
    .replace(/\s+/g, " ")
    .slice(0, 180);
}

function isFreeQuotaExhausted(status, result) {
  const detail = `${result?.error?.code || result?.code || ""} ${apiErrorDetail(result, status)}`;
  return status === 403 && /AllocationQuota\.FreeTierOnly|free.?tier|免费额度|quota/i.test(detail);
}

function isSwitchableVideoModelError(status, result) {
  if (status === 429 || status >= 500) return true;
  const detail = apiErrorDetail(result, status);
  return status === 400 && /model|support|duration|length|maximum|max |too long|input.*limit|stream/i.test(detail);
}

function videoOutputTokenLimit(durationSeconds) {
  if (durationSeconds >= 1800) return 32768;
  if (durationSeconds > LONG_VIDEO_SECONDS) return 16384;
  return 8192;
}

async function readXhsSubtitle(subtitleUrl, qwenError) {
  const request = new Request(subtitleUrl);
  request.timeoutInterval = 90;
  request.headers = mobileHeaders();
  const subtitleText = await request.loadString();
  ensureSuccess(request, "读取小红书字幕");
  const transcript = formatSrtTranscript(subtitleText);
  if (!transcript) throw qwenError;

  const reason = String(qwenError?.message || qwenError || "未知错误")
    .replace(/\s+/g, " ")
    .slice(0, 240);
  return `> 千问完整视频理解未完成，本次自动改用小红书自带中文字幕继续整理。画面细节可能不完整。\n> 原因：${reason}\n\n## 视频逐字转写（小红书字幕）\n\n${transcript}`;
}

function formatSrtTranscript(subtitleText) {
  const blocks = String(subtitleText).replace(/\r/g, "").trim().split(/\n{2,}/);
  return blocks.map(block => {
    const lines = block.split("\n").map(line => line.trim()).filter(Boolean);
    const timeIndex = lines.findIndex(line => line.includes("-->"));
    if (timeIndex < 0) return "";
    const start = lines[timeIndex].split("-->")[0].trim().replace(",", ".");
    const text = lines.slice(timeIndex + 1).join(" ").replace(/<[^>]+>/g, "").trim();
    return text ? `[${start}] ${text}` : "";
  }).filter(Boolean).join("\n");
}

function parseJsonResponse(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return { message: text };
  }
}

function parseQwenStreamText(responseText) {
  const direct = parseJsonResponse(responseText);
  const directContent = direct?.choices?.[0]?.message?.content;
  if (typeof directContent === "string") return directContent.trim();

  const parts = [];
  for (const line of String(responseText).split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const chunk = JSON.parse(data);
      const content = chunk?.choices?.[0]?.delta?.content;
      if (typeof content === "string") parts.push(content);
    } catch (_) {}
  }
  return parts.join("").trim();
}

async function readImagesWithQwen(imageUrls, apiKey, baseUrl) {
  const results = [];
  for (let start = 0; start < imageUrls.length; start += MAX_IMAGES_PER_REQUEST) {
    const batch = imageUrls.slice(start, start + MAX_IMAGES_PER_REQUEST);
    const stageLabel = `千问识别图片 ${start + 1}-${start + batch.length}`;
    currentStage = `等待${stageLabel}`;
    const content = [{
      type: "text",
      text: `请按顺序读取这 ${batch.length} 张小红书笔记图片。逐张输出“### 图片 N”，N 从 ${start + 1} 开始。完整抄录可辨识的中文、数字、表格和关键标注，再简要描述与文字理解相关的画面信息。看不清的地方标注“无法辨识”，不要猜测。`,
    }];
    batch.forEach(url => content.push({ type: "image_url", image_url: { url } }));

    const result = await loadQwenVisionWithRetry(content, apiKey, baseUrl, stageLabel);
    const text = result.choices?.[0]?.message?.content;
    if (!text || !text.trim()) throw new Error("千问图片识别结果为空");
    results.push(text.trim());
  }
  return results.join("\n\n");
}

async function loadQwenVisionWithRetry(content, apiKey, baseUrl, stageLabel) {
  for (let attempt = 1; attempt <= MAX_API_ATTEMPTS; attempt++) {
    const request = new Request(`${baseUrl}/chat/completions`);
    request.method = "POST";
    request.timeoutInterval = 240;
    request.headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    request.body = JSON.stringify({
      model: VISION_MODEL,
      temperature: 0.1,
      max_tokens: 4096,
      enable_thinking: false,
      stream: false,
      messages: [{ role: "user", content }],
    });

    const result = await request.loadJSON();
    const status = request.response ? request.response.statusCode : 0;
    if (status !== 429 || attempt === MAX_API_ATTEMPTS) {
      ensureSuccess(request, "千问图片识别", result, DASHSCOPE_KEY_NAME);
      return result;
    }

    const waitMs = parseRetryDelayMs(result, attempt);
    currentStage = `${stageLabel}触发限流，${Math.ceil(waitMs / 1000)} 秒后自动重试`;
    await sleep(waitMs);
  }
}

function parseRetryDelayMs(result, attempt) {
  const detail = String(result?.error?.message || result?.message || "");
  const match = detail.match(/try again in\s+([\d.]+)s/i);
  if (match) return Math.ceil(Number(match[1]) * 1000) + 1000;
  return attempt * 5000;
}

function sleep(milliseconds) {
  return new Promise(resolve => Timer.schedule(milliseconds, false, resolve));
}

async function summarizeNote(note, videoContent, imageContent, apiKey, baseUrl) {
  let sourceContent = note.type === "video" ? videoContent : imageContent;
  if (note.type === "video" && sourceContent.length > SUMMARY_CHUNK_CHARS) {
    const chunks = splitTextByLength(sourceContent, SUMMARY_CHUNK_CHARS);
    const partialSummaries = [];
    for (let index = 0; index < chunks.length; index++) {
      const stageLabel = `千问分段整理 ${index + 1}/${chunks.length}`;
      currentStage = `等待${stageLabel}`;
      const chunkPrompt = `请把下面这段长视频识别内容压缩为保真的分段笔记，供稍后汇总。保留人物观点、论证关系、操作步骤、重要时间点、数字和专有名词；删除口头重复，不要添加材料之外的信息。只输出简洁 Markdown 列表。\n\n${chunks[index]}`;
      partialSummaries.push(await loadQwenTextWithRetry(chunkPrompt, apiKey, baseUrl, stageLabel, 2400));
    }
    sourceContent = partialSummaries.map((text, index) => `### 分段 ${index + 1}\n${text}`).join("\n\n");
  }

  const material = note.type === "video"
    ? `视频的画面、字幕与声音识别内容：\n${sourceContent}`
    : `笔记类型：图文\n图片数量：${note.imageUrls.length}\n图片识别内容：\n${sourceContent}`;
  const sections = note.type === "video"
    ? "“## 内容摘要”“## 视频内容”“## 核心要点”“## 标签”四个部分"
    : "“## 内容摘要”“## 核心要点”“## 标签”三个部分";
  const prompt = `请根据以下小红书笔记信息生成结构化 Markdown 摘要。\n\n标题：${note.title}\n原文：${note.desc || "无"}\n${material}\n\n要求：\n1. 只依据材料，不要猜测或编造。图片识别内容可能有误，遇到矛盾或无法辨识的信息要明确说明。\n2. 输出${sections}。\n3. 内容摘要用一段话；核心要点使用列表；标签输出 3-8 个中文 Obsidian 标签。\n4. 涉及金额、比例、日期、政策条件时保留原始数值，并提醒读者以当地官方口径为准。\n5. 不要重复输出一级标题和来源链接。`;

  currentStage = "等待千问汇总结构化摘要";
  return loadQwenTextWithRetry(prompt, apiKey, baseUrl, "千问生成摘要", 4096);
}

async function loadQwenTextWithRetry(prompt, apiKey, baseUrl, stageLabel, maxTokens) {
  for (let attempt = 1; attempt <= MAX_API_ATTEMPTS; attempt++) {
    try {
      const request = new Request(`${baseUrl}/chat/completions`);
      request.method = "POST";
      request.timeoutInterval = 300;
      request.headers = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      };
      request.body = JSON.stringify({
        model: SUMMARY_MODEL,
        temperature: 0.2,
        max_tokens: maxTokens,
        enable_thinking: false,
        stream: false,
        messages: [
          { role: "system", content: "你是严谨的中文内容整理助手。" },
          { role: "user", content: prompt },
        ],
      });

      const result = await request.loadJSON();
      const status = request.response ? request.response.statusCode : 0;
      const retryable = status === 429 || status >= 500;
      if (retryable && attempt < MAX_API_ATTEMPTS) {
        const waitMs = parseRetryDelayMs(result, attempt);
        currentStage = `${stageLabel}暂时不可用，${Math.ceil(waitMs / 1000)} 秒后自动重试`;
        await sleep(waitMs);
        continue;
      }

      ensureSuccess(request, stageLabel, result, DASHSCOPE_KEY_NAME);
      const content = result.choices?.[0]?.message?.content;
      if (!content) throw new Error("摘要接口没有返回正文");
      return content.trim();
    } catch (error) {
      if (attempt === MAX_API_ATTEMPTS || /API Key|HTTP 4\d\d/.test(String(error?.message || error))) {
        throw error;
      }
      const waitMs = attempt * 5000;
      currentStage = `${stageLabel}网络中断，${waitMs / 1000} 秒后自动重试`;
      await sleep(waitMs);
    }
  }
}

function splitTextByLength(text, maxChars) {
  const chunks = [];
  let current = "";
  for (const originalLine of String(text).split("\n")) {
    let line = originalLine;
    while (line.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(line.slice(0, maxChars));
      line = line.slice(maxChars);
    }
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxChars) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}

function buildSummaryFallback(error) {
  const reason = String(error?.message || error || "未知错误").replace(/\s+/g, " ").slice(0, 240);
  return `## 内容摘要\n\n> 千问在自动重试后仍未完成摘要，但识别原文已经保留下来，本笔记仍会正常保存。\n> 原因：${reason}\n\n## 核心要点\n\n- 请展开下方识别原文查看完整内容。\n- 网络恢复后可以重新运行脚本生成结构化摘要。\n\n## 标签\n\n#待总结`;
}

function buildMarkdown(note, videoContent, imageContent, summary) {
  const captured = formatLocalDate(new Date());
  const displayTitle = String(note.title || "").trim() || "小红书摘录";
  const images = note.imageUrls.length
    ? `\n\n## 笔记图片\n\n${note.imageUrls.map((url, index) => `![小红书图片 ${index + 1}](${url})`).join("\n\n")}`
    : "";
  const videoContentBlock = videoContent
    ? `\n\n<details>\n<summary>视频识别原文</summary>\n\n${videoContent}\n\n</details>`
    : "";
  const imageContentBlock = imageContent
    ? `\n\n<details>\n<summary>图片识别原文</summary>\n\n${imageContent}\n\n</details>`
    : "";
  return `---\nsource: "${note.sourceUrl.replace(/"/g, '\\"')}"\nplatform: xiaohongshu\ncontent_type: ${note.type}\ncaptured: ${captured}\n---\n\n# ${displayTitle}\n\n> [查看原笔记](${note.sourceUrl})\n\n## 笔记原文\n\n${note.desc || "（原笔记没有文字说明）"}${images}\n\n${summary}${videoContentBlock}${imageContentBlock}\n`;
}

function buildNoteFilePath(title) {
  const safeTitle = String(title || "")
    .replace(/[\\/:*?"<>|#[\]^]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);

  return `00_Inbox 收集箱/来源-小红书/${safeTitle || "小红书摘录"}.md`;
}

function openInObsidian(title) {
  const file = buildNoteFilePath(title);

  Safari.open(
    `obsidian://new?vault=${encodeURIComponent("Cici个人系统")}&file=${encodeURIComponent(file)}&clipboard=true`
  );
}

function formatLocalDate(date) {
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
    if (keyName === DASHSCOPE_KEY_NAME && Keychain.contains(DASHSCOPE_BASE_URL_NAME)) {
      Keychain.remove(DASHSCOPE_BASE_URL_NAME);
    }
    const credential = keyName === DASHSCOPE_KEY_NAME ? "API Key 或 API Host 不匹配" : "API Key 无效";
    throw new Error(`${label}失败：${credential}，已自动清除，请重新运行后输入正确的信息`);
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

async function getDashscopeBaseUrl(requireDedicated, durationSeconds) {
  if (Keychain.contains(DASHSCOPE_BASE_URL_NAME)) {
    const saved = normalizeDashscopeBaseUrl(Keychain.get(DASHSCOPE_BASE_URL_NAME));
    if (!requireDedicated || isWorkspaceDedicatedBaseUrl(saved)) return saved;
  }
  if (!requireDedicated) return DEFAULT_DASHSCOPE_BASE_URL;

  const alert = new Alert();
  alert.title = "设置千问 API Host";
  alert.message = `这条视频约 ${formatDuration(durationSeconds)}。共享 DashScope 域名会在 600 秒超时；请粘贴创建当前 API Key 时显示的业务空间专属 API Host，脚本会把它保存在本机 Keychain。`;
  alert.addTextField("https://xxxx.cn-beijing.maas.aliyuncs.com", "");
  alert.addAction("保存并继续");
  alert.addCancelAction("取消");
  const choice = await alert.present();
  if (choice < 0) throw new Error("长视频需要业务空间专属 API Host，已取消设置");

  const baseUrl = normalizeDashscopeBaseUrl(alert.textFieldValue(0));
  if (!isWorkspaceDedicatedBaseUrl(baseUrl)) {
    throw new Error("API Host 格式不正确，应包含 .maas.aliyuncs.com；请从阿里云百炼 API Key 页面复制");
  }
  Keychain.set(DASHSCOPE_BASE_URL_NAME, baseUrl);
  return baseUrl;
}

function normalizeDashscopeBaseUrl(value) {
  let url = String(value || "").trim().replace(/\/+$/, "");
  url = url.replace(/\/chat\/completions$/, "");
  if (url && !/\/compatible-mode\/v1$/i.test(url)) url += "/compatible-mode/v1";
  return url;
}

function isWorkspaceDedicatedBaseUrl(url) {
  return /^https:\/\/[^/]+\.maas\.aliyuncs\.com\/compatible-mode\/v1$/i.test(url);
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  return `${minutes} 分 ${String(remain).padStart(2, "0")} 秒`;
}

async function showStartNotice(note) {
  const alert = new Alert();
  alert.title = "开始处理";
  const duration = note.durationSeconds ? `，时长约 ${formatDuration(note.durationSeconds)}` : "";
  const longVideoTip = note.durationSeconds > LONG_VIDEO_SECONDS
    ? "长视频完整解析可能需要 10-30 分钟，请让 Scriptable 保持在前台；若千问失败且笔记有中文字幕，脚本会自动用字幕继续整理。"
    : "通常需要 30 秒到数分钟。";
  alert.message = note.type === "video"
    ? `已识别为视频笔记${duration}。阿里云千问将同时理解画面、字幕和声音，并生成结构化摘要。${longVideoTip}`
    : "已识别为图文笔记。阿里云千问将分批读取图片文字和画面信息，并生成结构化摘要，通常需要 20 秒到数分钟。";
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
