const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, systemPreferences } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");

function loadDotEnv() {
  try {
    const content = fsSync.readFileSync(path.join(process.cwd(), ".env"), "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // Settings entered in the app take precedence when .env is absent.
  }
}

loadDotEnv();
const { planRequest } = require("../src/core/planner");
const { executePlan, getDiagnostics } = require("../src/core/executor");
const { testModelConnection } = require("../src/core/model");

let mainWindow;
let activeRun = null;

const DEFAULT_SETTINGS = {
  modelEnabled: true,
  speakResponses: true,
  wakeWordEnabled: true,
  wakeWordPhrase: "jarvis",
  voiceName: "",
  speechProvider: "browser",
  computerControl: true,
  screenUnderstanding: true,
  browserAutomation: true,
  terminalAccess: false,
  confirmationMode: "balanced",
  memoryEnabled: true,
  privacyMode: false,
  startAtLogin: true,
  modelBaseUrl: "",
  modelName: ""
};

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function secretPath() {
  return path.join(app.getPath("userData"), "model-key.bin");
}

function encryptApiKey(value) {
  if (!value) return;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure key storage is unavailable on this computer.");
  }
  return safeStorage.encryptString(value).toString("base64");
}

function decryptApiKey(value) {
  if (!value || !safeStorage.isEncryptionAvailable()) return "";
  try {
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  } catch {
    return "";
  }
}

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
    const raw = JSON.parse(await fs.readFile(settingsPath(), "utf8"));
    const encryptedKey = raw.modelApiKeyEncrypted || await fs.readFile(secretPath(), "utf8").catch(() => "");
    return { ...DEFAULT_SETTINGS, ...raw, modelApiKey: decryptApiKey(encryptedKey) };
  } catch {
    return { ...DEFAULT_SETTINGS, modelApiKey: "" };
  }
}

async function saveSettings(settings) {
  const dir = app.getPath("userData");
  await fs.mkdir(dir, { recursive: true });
  const current = await loadSettings();
  const next = { ...DEFAULT_SETTINGS, ...current, ...settings };
  const suppliedKey = typeof settings.modelApiKey === "string" ? settings.modelApiKey.trim() : "";
  if (suppliedKey) {
    const encrypted = encryptApiKey(suppliedKey);
    await fs.writeFile(secretPath(), encrypted, { mode: 0o600 });
  }
  delete next.modelApiKey;
  delete next.modelApiKeyEncrypted;
  await fs.writeFile(settingsPath(), JSON.stringify(next, null, 2), { mode: 0o600 });
  app.setLoginItemSettings({ openAtLogin: next.startAtLogin !== false });
  return publicSettings({ ...next, modelApiKey: suppliedKey || current.modelApiKey });
}

function publicSettings(settings) {
  const { modelApiKey, modelApiKeyEncrypted, ...safe } = settings;
  return {
    ...safe,
    modelApiKey: "",
    modelApiKeyConfigured: Boolean(modelApiKey)
  };
}

async function clearApiKey() {
  await fs.rm(secretPath(), { force: true });
  const settings = await loadSettings();
  delete settings.modelApiKey;
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), { mode: 0o600 });
  return publicSettings(settings);
}

function emit(event, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(event, payload);
}

ipcMain.handle("settings:get", async () => publicSettings(await loadSettings()));
ipcMain.handle("settings:save", (_event, settings) => saveSettings(settings));
ipcMain.handle("settings:clearKey", () => clearApiKey());
ipcMain.handle("model:testConnection", async (_event, settings) => {
  const stored = await loadSettings();
  return testModelConnection({ ...stored, ...settings, modelApiKey: settings.modelApiKey || stored.modelApiKey });
});

ipcMain.handle("memory:get", async () => {
  const file = path.join(app.getPath("userData"), "memory.json");
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return [];
  }
});

ipcMain.handle("memory:save", async (_event, memory) => {
  const file = path.join(app.getPath("userData"), "memory.json");
  const items = Array.isArray(memory) ? memory.slice(-100) : [];
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(items, null, 2), { mode: 0o600 });
  return items;
});

ipcMain.handle("memory:clear", async () => {
  const file = path.join(app.getPath("userData"), "memory.json");
  await fs.rm(file, { force: true });
  return [];
});

ipcMain.handle("assistant:ask", async (_event, { text, history = [], settings = {} }) => {
  if (activeRun) activeRun.abort();
  activeRun = new AbortController();
  const signal = activeRun.signal;
  const storedSettings = await loadSettings();
  const runtimeSettings = { ...storedSettings, ...settings, modelApiKey: storedSettings.modelApiKey };
  emit("assistant:stage", { stage: "understanding", label: "Understanding your request" });
  emit("assistant:activity", { type: "UNDERSTANDING", text });
  const plan = await planRequest(text, { history, settings: runtimeSettings, signal });
  if (signal.aborted) return { cancelled: true };
  if (plan.type === "cancel") {
    activeRun = null;
    return { plan, results: [{ ok: true, message: "Stopped the active task." }] };
  }
  emit("assistant:stage", { stage: "planning", label: `Planning ${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"}` });
  emit("assistant:activity", { type: "PLANNING", text: plan.summary });
  if (plan.requiresConfirmation) {
    activeRun = null;
    return { requiresConfirmation: true, plan, results: [] };
  }
  emit("assistant:stage", { stage: "action", label: "Executing approved actions" });
  const results = await executePlan(plan, { signal, emit, settings: runtimeSettings });
  activeRun = null;
  return { plan, results };
});

ipcMain.handle("assistant:confirm", async (_event, plan) => {
  activeRun = new AbortController();
  const settings = await loadSettings();
  emit("assistant:activity", { type: "PERMISSION", text: "Approved by the user." });
  emit("assistant:stage", { stage: "action", label: "Executing after confirmation" });
  const results = await executePlan(plan, { signal: activeRun.signal, emit, settings });
  activeRun = null;
  return { plan, results };
});

ipcMain.handle("assistant:stop", () => {
  if (activeRun) activeRun.abort();
  activeRun = null;
  return { ok: true };
});

ipcMain.handle("diagnostics:run", async () => {
  const settings = await loadSettings();
  return getDiagnostics(settings);
});
ipcMain.handle("system:openExternal", (_event, url) => shell.openExternal(url));
ipcMain.handle("system:showItem", (_event, itemPath) => shell.showItemInFolder(itemPath));
ipcMain.handle("system:chooseFile", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"] });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("system:platform", () => ({
  platform: process.platform,
  arch: process.arch,
  version: app.getVersion(),
  accessibilityTrusted: process.platform === "darwin" ? systemPreferences.isTrustedAccessibilityClient(false) : null
}));

app.whenReady().then(() => {
  loadSettings().then((settings) => {
    app.setLoginItemSettings({ openAtLogin: settings.startAtLogin !== false });
  }).catch(() => {});
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});