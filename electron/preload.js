const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("musicBridge", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),

  searchMusic: (payload) => ipcRenderer.invoke("music:search", payload),
  getTrackStream: (payload) => ipcRenderer.invoke("music:stream", payload),
  getCoverUrl: (payload) => ipcRenderer.invoke("music:cover", payload),
  getLyric: (payload) => ipcRenderer.invoke("music:lyric", payload),
  downloadTrack: (payload) => ipcRenderer.invoke("music:download", payload),

  recommendByAI: (payload) => ipcRenderer.invoke("ai:recommend", payload),
  testAI: () => ipcRenderer.invoke("ai:test"),

  addFavorite: (track) => ipcRenderer.invoke("favorites:add", track),
  removeFavorite: (payload) => ipcRenderer.invoke("favorites:remove", payload),
  listFavorites: () => ipcRenderer.invoke("favorites:list"),
  isFavorite: (payload) => ipcRenderer.invoke("favorites:is", payload),

  addHistory: (track) => ipcRenderer.invoke("history:add", track),
  listHistory: (payload) => ipcRenderer.invoke("history:list", payload),
  clearHistory: () => ipcRenderer.invoke("history:clear"),

  openExternal: (payload) => ipcRenderer.invoke("system:openExternal", payload)
});
