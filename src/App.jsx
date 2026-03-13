import React, { useEffect, useMemo, useRef, useState } from "react";

const PLAY_MODES = [
  { id: "loop", label: "列表循环" },
  { id: "shuffle", label: "随机播放" },
  { id: "single", label: "单曲循环" }
];

function getBridge() {
  const bridge = window.musicBridge;
  if (!bridge) {
    throw new Error("未检测到 Electron 桥接，请在桌面客户端窗口中使用（不要只开浏览器页面）。");
  }
  return bridge;
}

async function callBridge(method, payload) {
  const bridge = getBridge();
  if (typeof bridge[method] !== "function") {
    throw new Error(`桥接方法不可用: ${method}`);
  }
  if (typeof payload === "undefined") {
    return bridge[method]();
  }
  return bridge[method](payload);
}

function trackKey(track = {}) {
  return `${track.source || "unknown"}-${track.id || "unknown"}`;
}

function formatTime(seconds = 0) {
  if (!Number.isFinite(seconds)) {
    return "00:00";
  }
  const total = Math.max(0, Math.floor(seconds));
  const min = String(Math.floor(total / 60)).padStart(2, "0");
  const sec = String(total % 60).padStart(2, "0");
  return `${min}:${sec}`;
}

function parseLrcText(rawLyric = "", rawTlyric = "") {
  const lineReg = /\[(\d{2}):(\d{2}(?:\.\d{1,3})?)\]/g;
  const mainMap = new Map();
  const transMap = new Map();

  rawLyric.split("\n").forEach((line) => {
    const text = line.replace(lineReg, "").trim();
    const matches = [...line.matchAll(lineReg)];
    matches.forEach((m) => {
      const time = Number(m[1]) * 60 + Number(m[2]);
      if (text) {
        mainMap.set(time, text);
      }
    });
  });

  rawTlyric.split("\n").forEach((line) => {
    const text = line.replace(lineReg, "").trim();
    const matches = [...line.matchAll(lineReg)];
    matches.forEach((m) => {
      const time = Number(m[1]) * 60 + Number(m[2]);
      if (text) {
        transMap.set(time, text);
      }
    });
  });

  return [...mainMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, text]) => ({ time, text, ttext: transMap.get(time) || "" }));
}

function formatBackupEndpoints(endpoints = []) {
  return (endpoints || [])
    .filter((x) => x && x.baseUrl)
    .map((x) => `${x.baseUrl}|${x.apiKey || ""}|${x.model || ""}`)
    .join("\n");
}

function parseBackupEndpointsInput(text = "") {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [baseUrl, apiKey, model] = line.split("|").map((x) => (x || "").trim());
      return { baseUrl, apiKey, model };
    })
    .filter((x) => x.baseUrl && x.apiKey && x.model);
}

function stringifyMeta(value, fallback = "") {
  if (value === null || typeof value === "undefined") {
    return fallback;
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => stringifyMeta(item, ""))
      .filter(Boolean);
    return parts.length ? parts.join(" / ") : fallback;
  }
  if (typeof value === "object") {
    return (
      stringifyMeta(value.name, "") ||
      stringifyMeta(value.title, "") ||
      stringifyMeta(value.artist, "") ||
      stringifyMeta(value.artists, "") ||
      stringifyMeta(value.author, "") ||
      stringifyMeta(value.singer, "") ||
      fallback
    );
  }
  return fallback;
}

function artistText(track) {
  return stringifyMeta(track?.artist ?? track?.artists ?? track?.author, "未知歌手");
}

function albumText(track) {
  return stringifyMeta(track?.album ?? track?.albumname ?? track?.collection, "未知专辑");
}

function sourceText(track) {
  return stringifyMeta(track?.source, "");
}

function App() {
  const audioRef = useRef(null);
  const lyricListRef = useRef(null);
  const streamRetryRef = useRef({ key: "", count: 0 });

  const [config, setConfig] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(null);

  const [searchKeyword, setSearchKeyword] = useState("");
  const [ideaText, setIdeaText] = useState("");
  const [tracks, setTracks] = useState([]);
  const [keywords, setKeywords] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [history, setHistory] = useState([]);
  const [tab, setTab] = useState("discover");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedTrackKey, setSelectedTrackKey] = useState("");

  const [currentTrack, setCurrentTrack] = useState(null);
  const [coverUrl, setCoverUrl] = useState("");
  const [streamUrl, setStreamUrl] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playMode, setPlayMode] = useState("loop");
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [playQueue, setPlayQueue] = useState([]);

  const [lyrics, setLyrics] = useState([]);
  const [activeLyricIndex, setActiveLyricIndex] = useState(-1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const [loading, setLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [backupInput, setBackupInput] = useState("");
  const [accent, setAccent] = useState({ r: 111, g: 169, b: 255 });
  const repoUrl = "https://github.com/vaaagle/vaaagle-ai-music";

  const activeList = useMemo(() => {
    if (tab === "favorites") {
      return favorites;
    }
    if (tab === "history") {
      return history;
    }
    return tracks;
  }, [tab, favorites, history, tracks]);

  useEffect(() => {
    (async () => {
      try {
        const [cfg, favs, his] = await Promise.all([
          callBridge("getConfig"),
          callBridge("listFavorites"),
          callBridge("listHistory", { limit: 100 })
        ]);
        setConfig(cfg);
        setSettingsDraft(cfg);
        setBackupInput(formatBackupEndpoints(cfg?.openai?.backupEndpoints || []));
        setPlayMode(cfg.player?.playMode || "loop");
        setFavorites(favs || []);
        setHistory(his || []);
      } catch (err) {
        setMessage(err.message);
      }
    })();
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return undefined;
    }
    const onEnded = () => goNext(true);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onLoadedMeta = () => setDuration(audio.duration || 0);
    const onTimeUpdate = () => {
      const now = audio.currentTime || 0;
      setCurrentTime(now);
      if (!lyrics.length) {
        return;
      }
      let next = -1;
      for (let i = 0; i < lyrics.length; i += 1) {
        if (now >= lyrics[i].time) {
          next = i;
        } else {
          break;
        }
      }
      setActiveLyricIndex(next);
    };
    const onError = () => {
      const current = currentTrack;
      if (!current) {
        return;
      }
      const key = trackKey(current);
      const prev = streamRetryRef.current;
      if (prev.key !== key) {
        streamRetryRef.current = { key, count: 0 };
      }
      if (streamRetryRef.current.count < 1) {
        streamRetryRef.current = { key, count: streamRetryRef.current.count + 1 };
        setMessage("播放流异常，正在自动重试...");
        playTrack(current, getCurrentListIndex(), { retryCount: streamRetryRef.current.count });
      } else {
        setMessage("播放失败，已自动跳到下一首");
        goNext(false);
      }
    };

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("loadedmetadata", onLoadedMeta);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("loadedmetadata", onLoadedMeta);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("error", onError);
    };
  }, [lyrics, currentTrack, activeList, currentIndex]);

  useEffect(() => {
    if (activeLyricIndex < 0 || !lyricListRef.current) {
      return;
    }
    const el = lyricListRef.current.querySelector(`[data-lyric-index='${activeLyricIndex}']`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeLyricIndex]);

  useEffect(() => {
    if (!coverUrl) {
      setAccent({ r: 111, g: 169, b: 255 });
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) {
        return;
      }
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 18;
        canvas.height = 18;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          return;
        }
        ctx.drawImage(img, 0, 0, 18, 18);
        const pixels = ctx.getImageData(0, 0, 18, 18).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const alpha = pixels[i + 3];
          if (alpha < 32) {
            continue;
          }
          r += pixels[i];
          g += pixels[i + 1];
          b += pixels[i + 2];
          count += 1;
        }
        if (!count) {
          return;
        }
        setAccent({
          r: Math.round(r / count),
          g: Math.round(g / count),
          b: Math.round(b / count)
        });
      } catch {
        setAccent({ r: 111, g: 169, b: 255 });
      }
    };
    img.onerror = () => setAccent({ r: 111, g: 169, b: 255 });
    img.src = coverUrl;
    return () => {
      cancelled = true;
    };
  }, [coverUrl]);

  useEffect(() => {
    const list = activeList || [];
    if (!list.length) {
      setSelectedTrackKey("");
      return;
    }
    if (!selectedTrackKey || !list.some((x) => trackKey(x) === selectedTrackKey)) {
      setSelectedTrackKey(trackKey(list[0]));
    }
  }, [activeList, selectedTrackKey]);

  useEffect(() => {
    function onKeyDown(e) {
      const target = e.target;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        return;
      }
      if (!activeList.length) {
        return;
      }
      const current = selectedTrackKey
        ? activeList.findIndex((x) => trackKey(x) === selectedTrackKey)
        : -1;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = current < 0 ? 0 : Math.min(current + 1, activeList.length - 1);
        setSelectedTrackKey(trackKey(activeList[next]));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const next = current < 0 ? 0 : Math.max(current - 1, 0);
        setSelectedTrackKey(trackKey(activeList[next]));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const index = current < 0 ? 0 : current;
        playTrack(activeList[index], index);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeList, selectedTrackKey]);

  async function refreshFavorites() {
    const favs = await callBridge("listFavorites");
    setFavorites(favs || []);
  }

  async function refreshHistory() {
    const his = await callBridge("listHistory", { limit: 100 });
    setHistory(his || []);
  }

  async function handleSearch(keywordArg) {
    const keyword = (keywordArg || searchKeyword || "").trim();
    if (!keyword) {
      return;
    }
    setLoading(true);
    setMessage("正在多源搜索...");
    try {
      const data = await callBridge("searchMusic", {
        keyword,
        count: config?.music?.searchCount || 20,
        page: 1
      });
      setSearchKeyword(keyword);
      setTracks(data || []);
      setTab("discover");
      setMessage(`搜索完成，共 ${data?.length || 0} 首（已自动跨源容错）`);
    } catch (err) {
      setMessage(`搜索失败：${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleAIRecommend() {
    if (!ideaText.trim()) {
      return;
    }
    setLoading(true);
    setMessage("AI 正在分析你的想法...");
    try {
      const data = await callBridge("recommendByAI", { idea: ideaText.trim() });
      setTracks(data.tracks || []);
      setKeywords(data.keywords || []);
      setTab("discover");
      if (data?.diagnostics?.mode === "fallback") {
        setMessage(`AI 超时，已自动降级推荐，共 ${data?.tracks?.length || 0} 首。`);
      } else {
        setMessage(`推荐完成，共 ${data?.tracks?.length || 0} 首。`);
      }
    } catch (err) {
      setMessage(`AI 推荐失败：网络或配置异常，请检查 AI 配置。`);
    } finally {
      setLoading(false);
    }
  }

  async function playTrack(track, index = -1, options = {}) {
    if (!track) {
      return;
    }
    const { retryCount = 0 } = options;
    setCurrentIndex(index);
    setCurrentTrack(track);
    setSelectedTrackKey(trackKey(track));
    setCurrentTime(0);
    setDuration(0);
    setLyrics([]);
    setActiveLyricIndex(-1);
    setMessage(`正在加载：${track.name}`);

    try {
      const stream = await callBridge("getTrackStream", { track });
      if (!stream?.url) {
        throw new Error("未找到可播放链接");
      }

      const finalTrack = stream.resolvedTrack || track;
      setCurrentTrack(finalTrack);
      setStreamUrl(stream.url);
      streamRetryRef.current = { key: trackKey(finalTrack), count: 0 };

      const [cover, lyricPayload] = await Promise.all([
        callBridge("getCoverUrl", { picId: finalTrack.pic_id, source: finalTrack.source }),
        callBridge("getLyric", { lyricId: finalTrack.lyric_id || finalTrack.id, source: finalTrack.source })
      ]);
      setCoverUrl(cover || "");
      setLyrics(parseLrcText(lyricPayload?.lyric || "", lyricPayload?.tlyric || ""));

      await callBridge("addHistory", finalTrack);
      refreshHistory();

      setTimeout(() => {
        audioRef.current?.play().catch(() => setMessage("自动播放被阻止，请手动点击播放"));
      }, 0);
      setMessage(`正在播放：${finalTrack.name} - ${artistText(finalTrack)}`);
    } catch (err) {
      const canRetry = retryCount < 1;
      if (canRetry) {
        setMessage(`播放源异常，正在重试：${track.name}`);
        await playTrack(track, index, { retryCount: retryCount + 1 });
        return;
      }
      streamRetryRef.current = { key: trackKey(track), count: retryCount + 1 };
      setMessage(`播放失败，自动下一曲：${err.message}`);
      goNext(false);
    }
  }

  function getCurrentListIndex() {
    if (currentIndex >= 0) {
      return currentIndex;
    }
    if (!currentTrack) {
      return -1;
    }
    return activeList.findIndex((x) => trackKey(x) === trackKey(currentTrack));
  }

  function goPrev() {
    if (!activeList.length) {
      return;
    }
    const idx = getCurrentListIndex();
    const prevIndex = idx > 0 ? idx - 1 : activeList.length - 1;
    playTrack(activeList[prevIndex], prevIndex);
  }

  function goNext(fromEnded = false) {
    if (playQueue.length > 0) {
      const [nextTrack, ...rest] = playQueue;
      setPlayQueue(rest);
      playTrack(nextTrack, activeList.findIndex((x) => trackKey(x) === trackKey(nextTrack)));
      return;
    }
    if (!activeList.length) {
      return;
    }
    const idx = getCurrentListIndex();
    if (playMode === "single" && fromEnded && idx >= 0) {
      playTrack(activeList[idx], idx);
      return;
    }
    let nextIndex = idx + 1;
    if (playMode === "shuffle") {
      nextIndex = Math.floor(Math.random() * activeList.length);
    } else if (nextIndex >= activeList.length || idx < 0) {
      nextIndex = 0;
    }
    playTrack(activeList[nextIndex], nextIndex);
  }

  function togglePlay() {
    if (!audioRef.current || !streamUrl) {
      return;
    }
    if (audioRef.current.paused) {
      audioRef.current.play();
    } else {
      audioRef.current.pause();
    }
  }

  function playAll() {
    if (!activeList.length) {
      setMessage("当前列表为空");
      return;
    }
    playTrack(activeList[0], 0);
  }

  function addToNextQueue(track) {
    if (!track) {
      return;
    }
    setPlayQueue((prev) => {
      if (prev.some((x) => trackKey(x) === trackKey(track))) {
        return prev;
      }
      return [track, ...prev];
    });
    setMessage(`已加入“下一首播放”：${track.name}`);
  }

  function removeFromQueue(track) {
    setPlayQueue((prev) => prev.filter((x) => trackKey(x) !== trackKey(track)));
  }

  async function toggleFavorite(track) {
    const exists = favorites.some((x) => trackKey(x) === trackKey(track));
    if (exists) {
      await callBridge("removeFavorite", { id: track.id, source: track.source });
      setMessage(`已取消收藏：${track.name}`);
    } else {
      await callBridge("addFavorite", track);
      setMessage(`已收藏：${track.name}`);
    }
    refreshFavorites();
  }

  async function downloadSong(track) {
    if (!track) {
      return;
    }
    setIsDownloading(true);
    setMessage(`正在下载：${track.name}`);
    try {
      const result = await callBridge("downloadTrack", { track });
      setMessage(`下载完成：${result.filePath}`);
    } catch (err) {
      setMessage(`下载失败：${err.message}`);
    } finally {
      setIsDownloading(false);
    }
  }

  async function recommendSimilar() {
    if (!currentTrack) {
      setMessage("请先播放一首歌，再做相似推荐");
      return;
    }
    const prompt = `我在听 ${currentTrack.name} - ${artistText(currentTrack)}，请推荐相似风格。`;
    setIdeaText(prompt);
    try {
      const data = await callBridge("recommendByAI", { idea: prompt });
      setTracks(data.tracks || []);
      setKeywords(data.keywords || []);
      setTab("discover");
      setMessage("已生成相似推荐列表");
    } catch (err) {
      setMessage(`相似推荐失败：${err.message}`);
    }
  }

  async function saveSettings(shouldClose = true) {
    if (!settingsDraft) {
      return;
    }
    const next = {
      ...settingsDraft,
      openai: {
        ...(settingsDraft.openai || {}),
        requestTimeoutMs: Math.max(Number(settingsDraft.openai?.requestTimeoutMs || 20000), 5000),
        maxRetries: Math.max(Number(settingsDraft.openai?.maxRetries || 2), 0),
        backupEndpoints: parseBackupEndpointsInput(backupInput)
      },
      player: {
        ...(settingsDraft.player || {}),
        playMode
      }
    };
    const saved = await callBridge("saveConfig", next);
    setConfig(saved);
    setSettingsDraft(saved);
    setBackupInput(formatBackupEndpoints(saved?.openai?.backupEndpoints || []));
    if (shouldClose) {
      setSettingsOpen(false);
    }
    setMessage("配置已保存");
    return saved;
  }

  async function testAiConnectivity() {
    setAiTesting(true);
    setMessage("正在测试 AI 端点连通性...");
    try {
      await saveSettings(false);
      const result = await callBridge("testAI");
      if (result.ok) {
        setMessage(`AI 连通性测试通过：${result.summary}`);
      } else {
        setMessage(`AI 连通性测试失败：${result.summary}`);
      }
    } catch (err) {
      setMessage(`AI 连通性测试失败：${err.message}`);
    } finally {
      setAiTesting(false);
    }
  }

  function isFavoriteTrack(track) {
    return favorites.some((x) => trackKey(x) === trackKey(track));
  }

  function onSeek(seconds) {
    const next = Number(seconds);
    setCurrentTime(next);
    if (audioRef.current) {
      audioRef.current.currentTime = next;
    }
  }

  async function clearHistory() {
    await callBridge("clearHistory");
    setHistory([]);
    setMessage("已清空最近播放");
  }

  async function openRepo() {
    try {
      await callBridge("openExternal", { url: repoUrl });
    } catch {
      setMessage("打开 GitHub 失败，请手动复制链接");
    }
  }

  return (
    <div
      className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
      style={{
        "--accent-r": accent.r,
        "--accent-g": accent.g,
        "--accent-b": accent.b
      }}
    >
      <div className="workspace">
        <aside className="left-panel">
        <div className="brand-row">
          <button className="brand-toggle" title={sidebarCollapsed ? "展开侧栏" : "收起侧栏"} onClick={() => setSidebarCollapsed((x) => !x)}>
            {sidebarCollapsed ? <h1>V</h1> : <img className="brand-logo" src="./vaaagle_ai_music_logo_1.png" alt="Vaaagle AI Music" />}
            {!sidebarCollapsed ? <p className="subtitle">把你当前的想法转成可播放歌单</p> : null}
          </button>
        </div>

        {!sidebarCollapsed && (
          <>

            <textarea
              className="idea-box"
              value={ideaText}
              onChange={(e) => setIdeaText(e.target.value)}
              placeholder="例如：适合深夜学习的安静治愈中文歌"
            />

            <div className="row">
              <button className="btn primary" onClick={handleAIRecommend} disabled={loading}>
                <span className="btn-icon">✨</span>
                推荐
              </button>
              <button className="btn soft" onClick={recommendSimilar}>
                <span className="btn-icon">♫</span>
                相似
              </button>
            </div>

            <div className="search-wrap">
              <input
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="手动搜索歌曲/歌手/专辑"
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
              <button className="btn icon-only search-btn" onClick={() => handleSearch()} title="搜索">
                <span className="btn-icon">⌕</span>
              </button>
            </div>

            <div className="tag-wrap">
              {keywords.map((x) => (
                <button key={x.keyword} className="tag action-tag" title={x.reason} onClick={() => handleSearch(x.keyword)}>
                  {x.keyword}
                </button>
              ))}
            </div>

            <nav className="side-nav">
              <button className={`nav-item ${tab === "discover" ? "active" : ""}`} onClick={() => setTab("discover")}>
                <span className="btn-icon">◫</span>
                <span>推荐</span>
              </button>
              <button className={`nav-item ${tab === "favorites" ? "active" : ""}`} onClick={() => setTab("favorites")}>
                <span className="btn-icon">★</span>
                <span>收藏</span>
              </button>
              <button className={`nav-item ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>
                <span className="btn-icon">◷</span>
                <span>历史</span>
              </button>
              <button className="nav-item" onClick={() => setSettingsOpen(true)}>
                <span className="btn-icon">⚙</span>
                <span>配置</span>
              </button>
            </nav>

            <div className="row wrap-row">
              <button className="btn primary" onClick={playAll}>
                <span className="btn-icon">▶</span>
                全播
              </button>
              <button className="btn soft" onClick={clearHistory}>
                <span className="btn-icon">✕</span>
                清空
              </button>
            </div>

            <section className="queue-box">
              <div className="list-head compact">
                <h3>下一首队列</h3>
                <span>{playQueue.length} 首</span>
              </div>
              <div className="queue-list">
                {playQueue.length === 0 ? (
                  <p className="empty">双击列表行播放，图标加入下首队列</p>
                ) : (
                  playQueue.map((track) => (
                    <div key={`queue-${trackKey(track)}`} className="queue-item">
                      <span>{track.name}</span>
                      <button className="btn soft tiny" onClick={() => removeFromQueue(track)} title="移除">
                        <span className="btn-icon">✕</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>
          </>
        )}

          <p className="hint">{message}</p>
        </aside>

        <main className="main-panel">
        <section className="now-playing">
          <img src={coverUrl || "https://placehold.co/300x300/101c2d/dce9ff?text=No+Cover"} alt="cover" />
          <div className="track-info">
            <h2 title={currentTrack ? currentTrack.name : "还没有播放"}>{currentTrack ? currentTrack.name : "还没有播放"}</h2>
            <p>{currentTrack ? `${artistText(currentTrack)} / ${albumText(currentTrack)}` : "选一首开始"}</p>
            <div className="pill-wrap">
              <span className="pill">多源高可用播放</span>
              {currentTrack?.source ? <span className="pill source">当前源: {sourceText(currentTrack)}</span> : null}
            </div>
          </div>

          <div className="lyric-panel" ref={lyricListRef}>
            {lyrics.length === 0 ? (
              <p className="empty">暂无歌词，先享受旋律吧</p>
            ) : (
              lyrics.map((line, index) => (
                <div
                  key={`${line.time}-${index}`}
                  data-lyric-index={index}
                  className={`lyric-line ${index === activeLyricIndex ? "active" : ""}`}
                >
                  <p>{line.text}</p>
                  {line.ttext ? <span>{line.ttext}</span> : null}
                </div>
              ))
            )}
          </div>
        </section>

        <section className="track-list">
          <div className="list-head">
            <h3>{tab === "discover" ? "推荐/搜索结果" : tab === "favorites" ? "收藏列表" : "最近播放"}</h3>
            <span>{activeList.length} 首 · 双击播放</span>
          </div>
          <div className="list-body">
            {activeList.map((track, index) => {
              const playing = currentTrack && trackKey(track) === trackKey(currentTrack);
              const selected = selectedTrackKey && selectedTrackKey === trackKey(track);
              return (
                <div
                  key={trackKey(track)}
                  className={`track-row ${playing ? "playing" : ""} ${selected ? "selected" : ""}`}
                  onClick={() => setSelectedTrackKey(trackKey(track))}
                  onDoubleClick={() => playTrack(track, index)}
                >
                  <div className="meta" title="双击播放">
                    <b title={track.name}>{track.name}</b>
                    <span>
                      {artistText(track)} / {albumText(track)}
                    </span>
                  </div>
                  <div className="actions">
                    <button className="btn primary icon-only" title={playing ? "重播" : "播放"} onClick={() => playTrack(track, index)}>
                      <span className="btn-icon">{playing ? "↺" : "▶"}</span>
                    </button>
                    <button className="btn soft icon-only" title="下首播放" onClick={() => addToNextQueue(track)}>
                      <span className="btn-icon">⏭</span>
                    </button>
                    <button className="btn soft icon-only" title="下载" onClick={() => downloadSong(track)} disabled={isDownloading}>
                      <span className="btn-icon">⬇</span>
                    </button>
                    <button className="btn soft icon-only" title={isFavoriteTrack(track) ? "取消收藏" : "收藏"} onClick={() => toggleFavorite(track)}>
                      <span className="btn-icon">{isFavoriteTrack(track) ? "★" : "☆"}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        </main>
      </div>

      <section className="bottom-player global-player">
        <div className="player-meta">
          <strong title={currentTrack ? currentTrack.name : "未播放"}>{currentTrack ? currentTrack.name : "未播放"}</strong>
          <span>{currentTrack ? `${artistText(currentTrack)} · ${sourceText(currentTrack)}` : "选择歌曲开始播放"}</span>
          <div className="tiny-links">
            <button className="tiny-link" onClick={() => setDisclaimerOpen(true)} title="免责声明">
              免责声明
            </button>
            <button className="tiny-link" onClick={openRepo} title="GitHub 仓库">
              GitHub
            </button>
          </div>
        </div>
        <div className="transport">
          <button className="btn soft round" onClick={goPrev} disabled={!currentTrack} title="上一首">
            <span className="btn-icon">⏮</span>
          </button>
          <button className="btn primary hero icon-only" onClick={togglePlay} disabled={!currentTrack} title={isPlaying ? "暂停" : "播放"}>
            <span className="btn-icon">{isPlaying ? "⏸" : "▶"}</span>
          </button>
          <button className="btn soft round" onClick={() => goNext(false)} disabled={!currentTrack} title="下一首">
            <span className="btn-icon">⏭</span>
          </button>
          <select value={playMode} onChange={(e) => setPlayMode(e.target.value)}>
            {PLAY_MODES.map((mode) => (
              <option key={mode.id} value={mode.id}>
                {mode.label}
              </option>
            ))}
          </select>
          <button className="btn soft icon-only" onClick={() => downloadSong(currentTrack)} disabled={!currentTrack || isDownloading} title="下载当前">
            <span className="btn-icon">⬇</span>
          </button>
        </div>

        <div className="seek-wrap">
          <span>{formatTime(currentTime)}</span>
          <input
            type="range"
            min="0"
            max={Math.max(duration, 1)}
            step="0.1"
            value={Math.min(currentTime, Math.max(duration, 1))}
            onChange={(e) => onSeek(e.target.value)}
          />
          <span>{formatTime(duration)}</span>
        </div>

        <audio ref={audioRef} src={streamUrl} />
      </section>

      {settingsOpen && settingsDraft && (
        <div className="modal-mask">
          <div className="modal">
            <h3>AI 与接口配置</h3>
            <label>
              OpenAI Base URL
              <input
                value={settingsDraft.openai.baseUrl}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    openai: { ...settingsDraft.openai, baseUrl: e.target.value }
                  })
                }
              />
            </label>
            <label>
              备用端点（每行：baseUrl|token|model）
              <textarea className="backup-endpoints" value={backupInput} onChange={(e) => setBackupInput(e.target.value)} />
            </label>
            <label>
              API Key
              <input
                type="password"
                value={settingsDraft.openai.apiKey}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    openai: { ...settingsDraft.openai, apiKey: e.target.value }
                  })
                }
              />
            </label>
            <label>
              模型名称
              <input
                value={settingsDraft.openai.model}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    openai: { ...settingsDraft.openai, model: e.target.value }
                  })
                }
              />
            </label>
            <label>
              AI 超时时间（毫秒，默认 20000）
              <input
                type="number"
                value={settingsDraft.openai.requestTimeoutMs || 20000}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    openai: { ...settingsDraft.openai, requestTimeoutMs: Number(e.target.value || 20000) }
                  })
                }
              />
            </label>
            <label>
              最大重试次数（超时后自动 2 倍超时）
              <input
                type="number"
                value={settingsDraft.openai.maxRetries || 2}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    openai: { ...settingsDraft.openai, maxRetries: Number(e.target.value || 2) }
                  })
                }
              />
            </label>
            <label>
              音乐 API 基址
              <input
                value={settingsDraft.music.apiBase}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    music: { ...settingsDraft.music, apiBase: e.target.value }
                  })
                }
              />
              <small className="field-note">出处：GD音乐台(music.gdstudio.xyz)</small>
            </label>
            <label>
              主要音乐源
              <input
                value={settingsDraft.music.source}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    music: { ...settingsDraft.music, source: e.target.value }
                  })
                }
              />
            </label>
            <label>
              高可用源列表（逗号分隔）
              <input
                value={(settingsDraft.music.sources || []).join(",")}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    music: {
                      ...settingsDraft.music,
                      sources: e.target.value
                        .split(",")
                        .map((x) => x.trim())
                        .filter(Boolean)
                    }
                  })
                }
              />
            </label>
            <div className="row">
              <button className="btn primary" onClick={saveSettings}>
                保存
              </button>
              <button className="btn soft" onClick={testAiConnectivity} disabled={aiTesting}>
                {aiTesting ? "测试中" : "连通性测试"}
              </button>
              <button className="btn soft" onClick={() => setSettingsOpen(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {disclaimerOpen && (
        <div className="modal-mask">
          <div className="modal">
            <h3>免责声明</h3>
            <p className="disclaimer-text">
              本软件仅用于个人学习、技术研究与合法范围内的音乐信息检索演示，不存储、不制作、不分发受保护音频内容。
            </p>
            <p className="disclaimer-text">
              软件内展示与播放链接均来自用户自行配置或第三方公开接口，平台与开发者不对其合法性、完整性、可用性作任何明示或默示保证。
            </p>
            <p className="disclaimer-text">
              用户应确保其使用行为符合所在地法律法规及相关平台条款，特别是版权、邻接权与信息网络传播权等要求；如因使用本软件产生任何争议、索赔或损失，由使用者自行承担责任。
            </p>
            <p className="disclaimer-text">
              若权利人提出通知或异议，请用户立即停止相关使用并删除对应资源配置。继续使用即视为你已阅读并同意本声明。
            </p>
            <p className="disclaimer-text">
              项目仓库：
              <button className="inline-link" onClick={openRepo}>
                {repoUrl}
              </button>
            </p>
            <div className="row">
              <button className="btn primary" onClick={() => setDisclaimerOpen(false)}>
                我已知悉
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
