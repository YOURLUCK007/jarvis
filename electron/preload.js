const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jarvis", {
  ask: (payload) => ipcRenderer.invoke("assistant:ask", payload),
  confirm: (plan) => ipcRenderer.invoke("assistant:confirm", plan),
  stop: () => ipcRenderer.invoke("assistant:stop"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  diagnostics: () => ipcRenderer.invoke("diagnostics:run"),
  openExternal: (url) => ipcRenderer.invoke("system:openExternal", url),
  showItem: (itemPath) => ipcRenderer.invoke("system:showItem", itemPath),
  chooseFile: () => ipcRenderer.invoke("system:chooseFile"),
  onStage: (callback) => ipcRenderer.on("assistant:stage", (_event, payload) => callback(payload))
});