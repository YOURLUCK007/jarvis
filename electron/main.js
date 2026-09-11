const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { planRequest } = require("../src/core/planner");
const { executePlan, getDiagnostics } = require("../src/core/executor");

let mainWindow;
let activeRun = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1050,
    minHeight: 700,
    backgroundColor: "#071019",
    title: "Jarvis Desktop",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, "..", "src", "index.html"));
}

async function loadSettings() {
  try {
    const raw = await fs.readFile(path.join(app.getPath("userData"), "settings.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return { modelEnabled: true, speakResponses: true, theme: "dark" };
  }
}

async function saveSettings(settings) {
  const dir = app.getPath("userData");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "settings.json"), JSON.stringify(settings, null, 2));
  return settings;
}

function emit(event, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(event, payload);
}

ipcMain.handle("settings:get", () => loadSettings());
ipcMain.handle("settings:save", (_event, settings) => saveSettings(settings));

ipcMain.handle("assistant:ask", async (_event, { text, history = [], settings = {} }) => {
  if (activeRun) activeRun.abort();
  activeRun = new AbortController();
  const signal = activeRun.signal;
  emit("assistant:stage", { stage: "understanding", label: "Understanding your request" });
  const plan = await planRequest(text, { history, settings, signal });
  if (signal.aborted) return { cancelled: true };
  if (plan.type === "cancel") {
    activeRun = null;
    return { plan, results: [{ ok: true, message: "Stopped the active task." }] };
  }
  emit("assistant:stage", { stage: "planning", label: `Planning ${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"}` });
  if (plan.requiresConfirmation) {
    activeRun = null;
    return { requiresConfirmation: true, plan, results: [] };
  }
  emit("assistant:stage", { stage: "action", label: "Executing approved actions" });
  const results = await executePlan(plan, { signal, emit });
  activeRun = null;
  return { plan, results };
});

ipcMain.handle("assistant:confirm", async (_event, plan) => {
  activeRun = new AbortController();
  emit("assistant:stage", { stage: "action", label: "Executing after confirmation" });
  const results = await executePlan(plan, { signal: activeRun.signal, emit });
  activeRun = null;
  return { plan, results };
});

ipcMain.handle("assistant:stop", () => {
  if (activeRun) activeRun.abort();
  activeRun = null;
  return { ok: true };
});

ipcMain.handle("diagnostics:run", async () => getDiagnostics());
ipcMain.handle("system:openExternal", (_event, url) => shell.openExternal(url));
ipcMain.handle("system:showItem", (_event, itemPath) => shell.showItemInFolder(itemPath));
ipcMain.handle("system:chooseFile", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"] });
  return result.canceled ? [] : result.filePaths;
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});