const path = require("path");
const { app, BrowserWindow, ipcMain, Menu, shell } = require("electron");
const { getConfig, saveConfig } = require("./configStore");
const {
  initDb,
  addFavorite,
  removeFavorite,
  listFavorites,
  isFavorite,
  addPlayHistory,
  listPlayHistory,
  clearPlayHistory
} = require("./favoritesDb");
const { searchMusic, getCoverUrl, getLyric, resolvePlayableTrack, downloadTrack } = require("./musicService");
const { recommendTracks, testConnectivity } = require("./aiService");

const isDev = !app.isPackaged;

if (isDev) {
  app.setPath("userData", path.join(process.cwd(), ".electron-data"));
}

function createWindow() {
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1300,
    height: 860,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: "#091019",
    icon: path.join(__dirname, "assets", "app-icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (isDev) {
    const devUrl = process.env.DEV_SERVER_URL || "http://localhost:5188";
    win.loadURL(devUrl);
    win.webContents.on("did-fail-load", () => {
      win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
    });
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
  win.setMenuBarVisibility(false);
}

function registerIpc() {
  ipcMain.handle("config:get", async () => getConfig());

  ipcMain.handle("config:save", async (_event, config) => saveConfig(config));

  ipcMain.handle("music:search", async (_event, payload = {}) => {
    const config = getConfig();
    return searchMusic(config, payload.keyword, payload.count, payload.page);
  });

  ipcMain.handle("music:stream", async (_event, payload = {}) => {
    const config = getConfig();
    const inputTrack = payload.track || {
      id: payload.id,
      source: payload.source,
      name: payload.name,
      artist: payload.artist,
      album: payload.album,
      pic_id: payload.pic_id,
      lyric_id: payload.lyric_id
    };
    const { urlData, resolvedTrack } = await resolvePlayableTrack(config, inputTrack);
    return {
      ...urlData,
      resolvedTrack
    };
  });

  ipcMain.handle("music:cover", async (_event, payload = {}) => {
    const config = getConfig();
    return getCoverUrl(config, payload.picId, payload.source);
  });

  ipcMain.handle("music:lyric", async (_event, payload = {}) => {
    const config = getConfig();
    return getLyric(config, payload.lyricId || payload.id, payload.source);
  });

  ipcMain.handle("music:download", async (_event, payload = {}) => {
    const config = getConfig();
    const downloadDir = payload.downloadDir || path.join(app.getPath("downloads"), "VaaagleMusic");
    return downloadTrack(config, payload.track || payload, downloadDir);
  });

  ipcMain.handle("ai:recommend", async (_event, payload = {}) => {
    const config = getConfig();
    return recommendTracks(config, payload.idea || "");
  });

  ipcMain.handle("ai:test", async () => {
    const config = getConfig();
    return testConnectivity(config);
  });

  ipcMain.handle("favorites:add", async (_event, track) => addFavorite(track));
  ipcMain.handle("favorites:remove", async (_event, payload = {}) => removeFavorite(payload.id, payload.source));
  ipcMain.handle("favorites:list", async () => listFavorites());
  ipcMain.handle("favorites:is", async (_event, payload = {}) => isFavorite(payload.id, payload.source));

  ipcMain.handle("history:add", async (_event, track) => addPlayHistory(track));
  ipcMain.handle("history:list", async (_event, payload = {}) => listPlayHistory(payload.limit || 50));
  ipcMain.handle("history:clear", async () => clearPlayHistory());

  ipcMain.handle("system:openExternal", async (_event, payload = {}) => {
    if (!payload.url) {
      return false;
    }
    await shell.openExternal(payload.url);
    return true;
  });
}

app.whenReady().then(() => {
  initDb();
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
