const axios = require("axios");
const { searchMusic } = require("./musicService");

function parseJsonFromText(text) {
  if (!text) {
    return [];
  }
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const payload = fenced ? fenced[1] : text;
  try {
    const parsed = JSON.parse(payload);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const firstBracket = payload.indexOf("[");
    const lastBracket = payload.lastIndexOf("]");
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      try {
        return JSON.parse(payload.slice(firstBracket, lastBracket + 1));
      } catch {
        return [];
      }
    }
    return [];
  }
}

function normalizeOpenAIBaseUrl(url) {
  const cleaned = String(url || "").trim().replace(/\/$/, "");
  if (!cleaned) {
    return "";
  }
  if (cleaned.endsWith("/chat/completions")) {
    return cleaned.replace(/\/chat\/completions$/, "");
  }
  return cleaned;
}

function toEndpointObject(item, fallback) {
  if (!item) {
    return null;
  }
  if (typeof item === "string") {
    const baseUrl = normalizeOpenAIBaseUrl(item);
    if (!baseUrl) {
      return null;
    }
    return {
      baseUrl,
      apiKey: fallback.apiKey,
      model: fallback.model
    };
  }

  const baseUrl = normalizeOpenAIBaseUrl(item.baseUrl);
  if (!baseUrl) {
    return null;
  }
  return {
    baseUrl,
    apiKey: String(item.apiKey || fallback.apiKey || ""),
    model: String(item.model || fallback.model || "")
  };
}

function getEndpointCandidates(config) {
  const primary = {
    baseUrl: normalizeOpenAIBaseUrl(config.openai.baseUrl),
    apiKey: String(config.openai.apiKey || ""),
    model: String(config.openai.model || "")
  };
  const backups = Array.isArray(config.openai.backupEndpoints)
    ? config.openai.backupEndpoints
    : Array.isArray(config.openai.backupBaseUrls)
      ? config.openai.backupBaseUrls
      : [];

  const endpointList = [primary, ...backups.map((x) => toEndpointObject(x, primary))]
    .filter(Boolean)
    .filter((x) => x.baseUrl && x.apiKey && x.model);

  const dedupe = new Set();
  const result = [];
  endpointList.forEach((x) => {
    const key = `${x.baseUrl}|${x.model}|${x.apiKey.slice(0, 8)}`;
    if (!dedupe.has(key)) {
      dedupe.add(key);
      result.push(x);
    }
  });
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(error) {
  const code = error?.code;
  if (["ECONNABORTED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ECONNREFUSED"].includes(code)) {
    return true;
  }
  const status = error?.response?.status;
  if (!status) {
    return true;
  }
  return status >= 500 || status === 429;
}

function isTimeoutError(error) {
  return error?.code === "ECONNABORTED" || /timeout/i.test(String(error?.message || ""));
}

function formatError(error) {
  const status = error?.response?.status;
  const code = error?.code;
  if (status) {
    return `HTTP ${status}`;
  }
  if (code) {
    return code;
  }
  return error?.message || "unknown";
}

function extractLocalKeywords(ideaText) {
  const text = String(ideaText || "").trim();
  if (!text) {
    return [
      { keyword: "中文流行", reason: "默认兜底" },
      { keyword: "热门歌曲", reason: "默认兜底" },
      { keyword: "治愈音乐", reason: "默认兜底" }
    ];
  }

  const segments = text
    .replace(/[，。！？、,.!?;；]/g, " ")
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2)
    .slice(0, 6);

  const picks = [];
  const seen = new Set();
  for (const seg of segments) {
    if (!seen.has(seg)) {
      seen.add(seg);
      picks.push({ keyword: seg, reason: "本地降级提取" });
    }
    if (picks.length >= 5) {
      break;
    }
  }

  if (!picks.length) {
    return [{ keyword: text.slice(0, 12), reason: "本地降级提取" }];
  }
  return picks;
}

async function postChatCompletion(endpointConfig, body, timeoutMs) {
  const endpoint = `${endpointConfig.baseUrl}/chat/completions`;
  const response = await axios.post(endpoint, body, {
    headers: {
      Authorization: `Bearer ${endpointConfig.apiKey}`,
      "Content-Type": "application/json"
    },
    timeout: timeoutMs
  });
  return { response, endpoint };
}

async function requestKeywordsViaAi(config, ideaText) {
  const endpoints = getEndpointCandidates(config);
  if (!endpoints.length) {
    throw new Error("AI 地址/密钥/模型为空，请检查配置");
  }

  const baseTimeoutMs = Math.max(Number(config.openai.requestTimeoutMs || 20000), 5000);
  const maxRetries = Math.max(Number(config.openai.maxRetries || 2), 0);
  const body = {
    temperature: 0.65,
    messages: [
      {
        role: "system",
        content:
          "你是音乐推荐助手。根据用户想法，输出最契合的搜索关键词。只输出 JSON 数组，每项格式为 {\"keyword\":\"\",\"reason\":\"\"}，返回 3 到 5 项。"
      },
      {
        role: "user",
        content: ideaText
      }
    ]
  };

  const attempts = [];
  for (const endpointConfig of endpoints) {
    for (let retry = 0; retry <= maxRetries; retry += 1) {
      const timeoutMs = retry === 0 ? baseTimeoutMs : baseTimeoutMs * 2 ** retry;
      const start = Date.now();
      try {
        const { response, endpoint } = await postChatCompletion(
          endpointConfig,
          { ...body, model: endpointConfig.model },
          timeoutMs
        );
        const content = response.data?.choices?.[0]?.message?.content || "";
        const keywords = parseJsonFromText(content)
          .map((x) => ({
            keyword: String(x.keyword || "").trim(),
            reason: String(x.reason || "").trim()
          }))
          .filter((x) => x.keyword)
          .slice(0, 5);

        if (keywords.length) {
          return {
            keywords,
            diagnostics: {
              mode: "ai",
              endpoint,
              model: endpointConfig.model,
              timeoutMs,
              retries: retry,
              latencyMs: Date.now() - start,
              attempts
            }
          };
        }
        throw new Error("AI 返回内容缺少关键词");
      } catch (error) {
        const endpoint = `${endpointConfig.baseUrl}/chat/completions`;
        const latencyMs = Date.now() - start;
        attempts.push({
          endpoint,
          model: endpointConfig.model,
          retry,
          timeoutMs,
          latencyMs,
          timeoutExpanded: retry > 0 && isTimeoutError(error),
          error: formatError(error)
        });
        if (!shouldRetry(error) || retry >= maxRetries) {
          break;
        }
        const backoff = Math.floor((700 * 2 ** retry) + Math.random() * 220);
        await sleep(backoff);
      }
    }
  }

  const detail = attempts.map((x) => `${x.error}@${x.endpoint}`).join("; ");
  throw new Error(`AI 请求失败: ${detail || "unknown"}`);
}

async function requestKeywords(config, ideaText) {
  try {
    return await requestKeywordsViaAi(config, ideaText);
  } catch (error) {
    const fallbackKeywords = extractLocalKeywords(ideaText);
    return {
      keywords: fallbackKeywords,
      diagnostics: {
        mode: "fallback",
        reason: error.message
      }
    };
  }
}

async function recommendTracks(config, ideaText) {
  const { keywords, diagnostics } = await requestKeywords(config, ideaText);
  const result = [];
  const seen = new Set();

  for (const item of keywords) {
    const tracks = await searchMusic(config, item.keyword, Math.min(config.music.searchCount || 20, 15), 1);
    tracks.slice(0, 8).forEach((track) => {
      const key = `${track.source}-${track.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ ...track, reason: item.reason, byKeyword: item.keyword });
      }
    });
    if (result.length >= 40) {
      break;
    }
  }

  return {
    keywords,
    tracks: result.slice(0, 40),
    diagnostics
  };
}

async function testConnectivity(config) {
  const endpoints = getEndpointCandidates(config);
  if (!endpoints.length) {
    return {
      ok: false,
      summary: "没有可用端点，请先配置 baseUrl/apiKey/model",
      details: []
    };
  }

  const baseTimeoutMs = Math.max(Number(config.openai.requestTimeoutMs || 20000), 5000);
  const results = [];
  for (const ep of endpoints) {
    const timeoutMs = baseTimeoutMs;
    const start = Date.now();
    try {
      const { endpoint } = await postChatCompletion(
        ep,
        {
          model: ep.model,
          temperature: 0,
          messages: [{ role: "user", content: "请仅返回OK" }],
          max_tokens: 8
        },
        timeoutMs
      );
      results.push({ ok: true, endpoint, model: ep.model, latencyMs: Date.now() - start, timeoutMs });
    } catch (error) {
      results.push({
        ok: false,
        endpoint: `${ep.baseUrl}/chat/completions`,
        model: ep.model,
        latencyMs: Date.now() - start,
        timeoutMs,
        error: formatError(error)
      });
    }
  }

  const okCount = results.filter((x) => x.ok).length;
  return {
    ok: okCount > 0,
    summary: `可用端点 ${okCount}/${results.length}`,
    details: results
  };
}

module.exports = {
  recommendTracks,
  testConnectivity
};
