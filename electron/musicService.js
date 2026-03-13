const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const axios = require("axios");

const STABLE_SOURCES = ["netease", "kuwo", "joox", "bilibili"];

function getSourceCandidates(config, preferredSource) {
  const custom = Array.isArray(config.music.sources) ? config.music.sources : [];
  const primary = preferredSource || config.music.source || "netease";
  const merged = [primary, ...custom, ...STABLE_SOURCES].filter(Boolean);
  return [...new Set(merged)];
}

async function searchFromSource(config, source, keyword, count = 20, page = 1) {
  const response = await axios.get(config.music.apiBase, {
    params: {
      types: "search",
      source,
      name: keyword,
      count,
      pages: page
    },
    timeout: 15000
  });
  return Array.isArray(response.data) ? response.data : [];
}

function makeSongFingerprint(track = {}) {
  const n = String(track.name || "").toLowerCase().replace(/\s+/g, "");
  const a = String(track.artist || "")
    .toLowerCase()
    .split(/[\/,&]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join("|");
  return `${n}|${a}`;
}

async function searchMusic(config, keyword, count = 20, page = 1) {
  const sources = getSourceCandidates(config);
  const merged = [];
  const seen = new Set();

  for (const source of sources) {
    const remaining = count - merged.length;
    if (remaining <= 0) {
      break;
    }
    let batch = [];
    try {
      batch = await searchFromSource(config, source, keyword, Math.min(Math.max(remaining + 4, 8), 25), page);
    } catch {
      batch = [];
    }
    batch.forEach((item) => {
      const key = makeSongFingerprint(item);
      if (!seen.has(key) && merged.length < count) {
        seen.add(key);
        merged.push(item);
      }
    });
  }

  return merged;
}

async function getTrackUrl(config, trackId, source) {
  const response = await axios.get(config.music.apiBase, {
    params: {
      types: "url",
      source: source || config.music.source,
      id: trackId,
      br: config.music.bitrate || 320
    },
    timeout: 15000
  });
  return response.data || {};
}

async function getCoverUrl(config, picId, source) {
  if (!picId) {
    return "";
  }
  const response = await axios.get(config.music.apiBase, {
    params: {
      types: "pic",
      source: source || config.music.source,
      id: picId,
      size: 500
    },
    timeout: 15000
  });
  return response.data?.url || "";
}

async function getLyric(config, lyricId, source) {
  if (!lyricId) {
    return { lyric: "", tlyric: "" };
  }
  const response = await axios.get(config.music.apiBase, {
    params: {
      types: "lyric",
      source: source || config.music.source,
      id: lyricId
    },
    timeout: 15000
  });
  return response.data || { lyric: "", tlyric: "" };
}

function pickBestCandidate(candidates, trackName) {
  if (!candidates.length) {
    return null;
  }
  const low = String(trackName || "").toLowerCase();
  const exact = candidates.find((x) => String(x.name || "").toLowerCase() === low);
  if (exact) {
    return exact;
  }
  const fuzzy = candidates.find((x) => String(x.name || "").toLowerCase().includes(low) || low.includes(String(x.name || "").toLowerCase()));
  return fuzzy || candidates[0];
}

async function resolvePlayableTrack(config, track) {
  const urlData = await getTrackUrl(config, track.id, track.source);
  if (urlData?.url) {
    return { urlData, resolvedTrack: track };
  }

  const sources = getSourceCandidates(config, track.source).filter((x) => x !== track.source);
  const firstArtist = String(track.artist || "")
    .split(/[\/,&]/)
    .map((x) => x.trim())
    .filter(Boolean)[0];
  const fallbackKeyword = [track.name, firstArtist].filter(Boolean).join(" ");

  for (const source of sources) {
    let candidates = [];
    try {
      candidates = await searchFromSource(config, source, fallbackKeyword || track.name, 10, 1);
    } catch {
      candidates = [];
    }
    const candidate = pickBestCandidate(candidates, track.name);
    if (!candidate) {
      continue;
    }
    try {
      const candidateUrl = await getTrackUrl(config, candidate.id, candidate.source || source);
      if (candidateUrl?.url) {
        return {
          urlData: candidateUrl,
          resolvedTrack: {
            ...track,
            ...candidate,
            source: candidate.source || source
          }
        };
      }
    } catch {
      continue;
    }
  }

  throw new Error("该歌曲在当前可用音乐源中暂不可播放");
}

function sanitizeFileName(name) {
  return String(name || "song")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

async function downloadTrack(config, track, downloadDir) {
  const { urlData, resolvedTrack } = await resolvePlayableTrack(config, track);
  if (!urlData?.url) {
    throw new Error("下载失败：未找到可用音频链接");
  }

  const ext = ".mp3";
  const fileName = sanitizeFileName(`${resolvedTrack.name} - ${resolvedTrack.artist || "Unknown"}`) + ext;
  const finalDir = downloadDir || path.join(process.env.USERPROFILE || process.cwd(), "Downloads", "VaaagleMusic");
  fs.mkdirSync(finalDir, { recursive: true });
  const targetPath = path.join(finalDir, fileName);

  const response = await axios.get(urlData.url, {
    responseType: "stream",
    timeout: 30000
  });
  await pipeline(response.data, fs.createWriteStream(targetPath));

  return {
    filePath: targetPath,
    source: resolvedTrack.source,
    br: urlData.br || "unknown"
  };
}

module.exports = {
  searchMusic,
  getTrackUrl,
  getCoverUrl,
  getLyric,
  resolvePlayableTrack,
  downloadTrack
};
