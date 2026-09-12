const $ = (selector) => document.querySelector(selector);
const conversation = $("#conversation");
const input = $("#input");
const stage = $("#stage");
const stageText = $("#stageText");
const confirmation = $("#confirmation");
const activityLog = $("#activityLog");

let history = [];
let memory = [];
let pendingPlan = null;
let recognition;
let wakeRecognition;
let wakeRestartTimer;
let voiceStopped = false;
let pushListening = false;
let speechVoices = [];
let settings = {
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
  startAtLogin: true
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
}

function addMessage(role, content, meta = role === "user" ? "You" : "Jarvis") {
  const welcome = $(".welcome");
  if (welcome) welcome.remove();
  const item = document.createElement("div");
  item.className = `message ${role}`;
  item.innerHTML = `<span class="meta">${escapeHtml(meta)}</span>${escapeHtml(content)}`;
  conversation.appendChild(item);
  conversation.scrollTop = conversation.scrollHeight;
  if (role === "user" || role === "assistant") history.push({ role, content });
}

function setStage(label, busy = false) {
  stageText.textContent = label;
  stage.classList.toggle("busy", busy);
}

function logActivity(type, text) {
  const row = document.createElement("div");
  row.className = "log-entry";
  row.innerHTML = `<time>${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><b>${escapeHtml(type)}</b><span>${escapeHtml(text)}</span>`;
  activityLog.prepend(row);
}

function selectedVoice() {
  return speechVoices.find((voice) => voice.name === settings.voiceName)
    || speechVoices.find((voice) => voice.lang === navigator.language)
    || speechVoices.find((voice) => voice.lang?.startsWith("en"))
    || speechVoices[0];
}

function speak(text) {
  if (!settings.speakResponses || !("speechSynthesis" in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = selectedVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = 1.02;
  utterance.pitch = 0.98;
  window.speechSynthesis.speak(utterance);
}

function renderResults(response) {
  const messages = response.results || [];
  if (!messages.length && response.plan?.summary) addMessage("assistant", response.plan.summary);
  messages.forEach((result) => {
    const text = result.message || (result.ok ? "Done." : "That step failed.");
    addMessage("assistant", text);
    logActivity(result.ok ? "COMPLETE" : "ERROR", text);
    if (result.items?.length) {
      const preview = result.items.slice(0, 8).map((item) => {
        if (typeof item === "string") return item;
        return `${item.type === "folder" ? "▣" : "□"} ${item.title || item.name || item.path || item.url || ""}`;
      }).join("\n");
      addMessage("assistant", preview, "Results");
    }
    if (result.path) logActivity("OUTPUT", result.path);
    if (result.memory && settings.memoryEnabled) {
      memory = [...memory, result.memory].slice(-100);
      window.jarvis.saveMemory(memory);
      renderMemory();
    }
    if (result.ok) speak(text);
  });
}

function stopVoice() {
  voiceStopped = true;
  clearTimeout(wakeRestartTimer);
  try { recognition?.stop(); } catch {}
  try { wakeRecognition?.stop(); } catch {}
  window.speechSynthesis?.cancel();
  $("#micBtn")?.classList.remove("listening");
}

async function submit(text) {
  const value = (text || input.value).trim();
  if (!value) return;
  if (/^(stop|cancel|abort|never mind|nevermind|jarvis stop)\b/i.test(value)) {
    await window.jarvis.stop();
    stopVoice();
    addMessage("assistant", "Stopped.");
    setStage("Standing by", false);
    return;
  }
  input.value = "";
  addMessage("user", value);
  setStage("Understanding your request", true);
  $("#stopBtn").classList.remove("hidden");
  logActivity("VOICE INPUT", value);
  try {
    const response = await window.jarvis.ask({ text: value, history, settings });
    if (response.cancelled) return;
    if (response.requiresConfirmation) {
      pendingPlan = response.plan;
      confirmation.innerHTML = `<h3>Permission required</h3><p>${escapeHtml(response.plan.summary)}<br />${response.plan.steps.map((step) => `• ${escapeHtml(step.tool.replaceAll("_", " "))}: ${escapeHtml(JSON.stringify(step.input))}`).join("<br />")}</p><div class="confirm-actions"><button class="confirm-yes" id="confirmYes">Approve and run</button><button class="confirm-no" id="confirmNo">Cancel</button></div>`;
      confirmation.classList.remove("hidden");
      $("#confirmYes").onclick = confirmPlan;
      $("#confirmNo").onclick = cancelPlan;
      setStage("Waiting for your permission", false);
      logActivity("PERMISSION", response.plan.summary);
    } else {
      renderResults(response);
    }
  } catch (error) {
    addMessage("assistant", `I couldn’t complete that: ${error.message}`);
    logActivity("ERROR", error.message);
    speak("I couldn't complete that.");
  } finally {
    $("#stopBtn").classList.add("hidden");
    if (!pendingPlan) setStage("Standing by", false);
    if (settings.wakeWordEnabled && !voiceStopped) startWakeListener();
  }
}

async function confirmPlan() {
  if (!pendingPlan) return;
  const plan = pendingPlan;
  pendingPlan = null;
  confirmation.classList.add("hidden");
  setStage("Executing approved actions", true);
  try { renderResults(await window.jarvis.confirm(plan)); }
  catch (error) { addMessage("assistant", `The approved task failed: ${error.message}`); }
  setStage("Standing by", false);
  if (settings.wakeWordEnabled && !voiceStopped) startWakeListener();
}

function cancelPlan() {
  pendingPlan = null;
  confirmation.classList.add("hidden");
  addMessage("assistant", "I left that action untouched.");
  setStage("Standing by", false);
  if (settings.wakeWordEnabled && !voiceStopped) startWakeListener();
}

async function runDiagnostics() {
  const container = $("#diagnostics");
  container.innerHTML = "<div class='diag'><div class='diag-top'>Running checks…</div></div>";
  const result = await window.jarvis.diagnostics();
  const clientChecks = [];
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  clientChecks.push({ name: "Microphone", ok: Boolean(navigator.mediaDevices?.getUserMedia), detail: navigator.mediaDevices ? "Browser microphone API available" : "Microphone API unavailable" });
  clientChecks.push({ name: "Speech recognition", ok: Boolean(SpeechRecognition), detail: SpeechRecognition ? "Browser speech recognition available" : "Use push-to-talk with a supported Chromium build" });
  clientChecks.push({ name: "Speaker", ok: "speechSynthesis" in window, detail: "Browser speech synthesis available" });
  container.innerHTML = [...clientChecks, ...result.checks].map((item) => `<div class="diag"><div class="diag-top"><span>${escapeHtml(item.name)}</span><b class="${item.ok ? "ok" : "fail"}">${item.ok ? "PASS" : "CHECK"}</b></div><small>${escapeHtml(item.detail)}</small></div>`).join("");
}

function loadVoices() {
  if (!("speechSynthesis" in window)) return;
  speechVoices = window.speechSynthesis.getVoices();
  const select = $("#voiceName");
  if (!select) return;
  const current = settings.voiceName;
  select.innerHTML = `<option value="">System default</option>${speechVoices.map((voice) => `<option value="${escapeHtml(voice.name)}">${escapeHtml(voice.name)} · ${escapeHtml(voice.lang)}</option>`).join("")}`;
  select.value = current;
}

function startPushRecognition() {
  if (!recognition) return;
  voiceStopped = false;
  pushListening = true;
  try { recognition.start(); } catch { try { recognition.stop(); } catch {} }
}

function startWakeListener() {
  if (!wakeRecognition || !settings.wakeWordEnabled || voiceStopped || pendingPlan) return;
  clearTimeout(wakeRestartTimer);
  try { wakeRecognition.start(); } catch {}
}

function setupVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $("#micBtn");
  if (!SpeechRecognition) {
    mic.title = "Speech recognition is not available; use typing";
    logActivity("VOICE", "Speech recognition is unavailable in this Electron runtime.");
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = navigator.language || "en-US";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.onstart = () => { mic.classList.add("listening"); setStage("Listening…", true); };
  recognition.onend = () => {
    pushListening = false;
    mic.classList.remove("listening");
    if (!pendingPlan) setStage("Standing by", false);
    if (settings.wakeWordEnabled && !voiceStopped) startWakeListener();
  };
  recognition.onerror = (event) => { logActivity("VOICE", event.error); };
  recognition.onresult = (event) => {
    const transcript = Array.from(event.results).map((result) => result[0].transcript).join("");
    input.value = transcript;
    if (event.results[0].isFinal) submit(transcript);
  };
  mic.onclick = () => {
    stopVoice();
    voiceStopped = false;
    startPushRecognition();
  };

  wakeRecognition = new SpeechRecognition();
  wakeRecognition.lang = navigator.language || "en-US";
  wakeRecognition.interimResults = false;
  wakeRecognition.continuous = true;
  wakeRecognition.onstart = () => { $("#wakeState").textContent = "Listening"; };
  wakeRecognition.onend = () => {
    $("#wakeState").textContent = settings.wakeWordEnabled ? "Reconnecting…" : "Off";
    if (settings.wakeWordEnabled && !voiceStopped && !pushListening && !pendingPlan) wakeRestartTimer = setTimeout(startWakeListener, 900);
  };
  wakeRecognition.onerror = (event) => {
    if (event.error !== "aborted" && event.error !== "no-speech") logActivity("WAKE WORD", event.error);
  };
  wakeRecognition.onresult = (event) => {
    const phrase = String(settings.wakeWordPhrase || "jarvis").trim().toLowerCase();
    const transcript = Array.from(event.results).map((result) => result[0].transcript).join(" ").trim();
    const lower = transcript.toLowerCase();
    const index = lower.indexOf(phrase);
    if (index < 0) return;
    const command = transcript.slice(index + phrase.length).replace(/^[\s,!.:-]+/, "").trim();
    wakeRecognition.stop();
    voiceStopped = false;
    if (command) {
      submit(command);
    } else {
      setStage("Listening for your command", true);
      speak("Yes?");
      startPushRecognition();
    }
  };
  startWakeListener();
}

function switchPanel(name) {
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.panel === name));
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("active-panel"));
  $(`#${name}Panel`).classList.add("active-panel");
}

function applySettingsToUi() {
  $("#modelBaseUrl").value = settings.modelBaseUrl || "";
  $("#modelName").value = settings.modelName || "";
  $("#modelEnabled").checked = settings.modelEnabled !== false;
  $("#speakResponses").checked = settings.speakResponses !== false;
  $("#wakeWordEnabled").checked = settings.wakeWordEnabled !== false;
  $("#wakeWordPhrase").value = settings.wakeWordPhrase || "jarvis";
  $("#computerControl").checked = settings.computerControl !== false;
  $("#screenUnderstanding").checked = settings.screenUnderstanding !== false;
  $("#browserAutomation").checked = settings.browserAutomation !== false;
  $("#terminalAccess").checked = settings.terminalAccess === true;
  $("#memoryEnabled").checked = settings.memoryEnabled !== false;
  $("#privacyMode").checked = settings.privacyMode === true;
  $("#startAtLogin").checked = settings.startAtLogin !== false;
  $("#confirmationMode").value = settings.confirmationMode || "balanced";
  $("#speechProvider").value = settings.speechProvider || "browser";
  $("#modelState").textContent = settings.modelApiKeyConfigured ? "Configured" : "Not configured";
  $("#wakeState").textContent = settings.wakeWordEnabled !== false ? "Listening" : "Off";
  loadVoices();
}

async function loadSettings() {
  settings = { ...settings, ...(await window.jarvis.getSettings()) };
  applySettingsToUi();
  memory = await window.jarvis.getMemory();
  renderMemory();
}

function collectSettings() {
  return {
    ...settings,
    modelBaseUrl: $("#modelBaseUrl").value.trim(),
    modelName: $("#modelName").value.trim(),
    modelApiKey: $("#modelApiKey").value.trim(),
    modelEnabled: $("#modelEnabled").checked,
    speakResponses: $("#speakResponses").checked,
    wakeWordEnabled: $("#wakeWordEnabled").checked,
    wakeWordPhrase: $("#wakeWordPhrase").value.trim() || "jarvis",
    computerControl: $("#computerControl").checked,
    screenUnderstanding: $("#screenUnderstanding").checked,
    browserAutomation: $("#browserAutomation").checked,
    terminalAccess: $("#terminalAccess").checked,
    memoryEnabled: $("#memoryEnabled").checked,
    privacyMode: $("#privacyMode").checked,
    startAtLogin: $("#startAtLogin").checked,
    confirmationMode: $("#confirmationMode").value,
    speechProvider: $("#speechProvider").value,
    voiceName: $("#voiceName").value
  };
}

function renderMemory() {
  const target = $("#memoryList");
  if (!target) return;
  target.innerHTML = memory.length ? memory.map((item) => `<div class="memory-item">${escapeHtml(item)}</div>`).join("") : "<span class='muted'>No saved memories.</span>";
}

$("#composer").addEventListener("submit", (event) => { event.preventDefault(); submit(); });
input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } });
$("#stopBtn").onclick = async () => { await window.jarvis.stop(); stopVoice(); setStage("Stopped", false); $("#stopBtn").classList.add("hidden"); };
document.querySelectorAll("[data-prompt]").forEach((button) => button.onclick = () => submit(button.dataset.prompt));
document.querySelectorAll(".nav-item").forEach((button) => button.onclick = () => switchPanel(button.dataset.panel));
$("#diagnosticsBtn").onclick = () => { switchPanel("diagnostics"); runDiagnostics(); };
$("#runDiagnostics").onclick = runDiagnostics;
$("#clearLog").onclick = () => { activityLog.innerHTML = ""; };
$("#saveSettings").onclick = async () => {
  settings = collectSettings();
  await window.jarvis.saveSettings(settings);
  applySettingsToUi();
  logActivity("SETTINGS", "Settings saved locally.");
  setStage("Settings saved", false);
  stopVoice();
  voiceStopped = false;
  setupVoice();
};
$("#testConnection").onclick = async () => {
  const button = $("#testConnection");
  button.disabled = true;
  button.textContent = "Testing…";
  const result = await window.jarvis.testConnection(collectSettings());
  $("#connectionResult").textContent = result.message;
  $("#connectionResult").className = result.ok ? "connection-success" : "connection-failure";
  button.disabled = false;
  button.textContent = "Test connection";
};
$("#clearApiKey").onclick = async () => {
  settings = await window.jarvis.clearApiKey();
  applySettingsToUi();
  logActivity("SETTINGS", "The stored model key was cleared.");
};
$("#clearMemory").onclick = async () => {
  memory = await window.jarvis.clearMemory();
  renderMemory();
  logActivity("MEMORY", "Local memory cleared.");
};
window.jarvis.onStage(({ label }) => { setStage(label, true); logActivity("STATUS", label); });
window.jarvis.onActivity(({ type, text }) => logActivity(type, text));
window.speechSynthesis?.addEventListener("voiceschanged", loadVoices);
loadSettings().then(setupVoice).catch((error) => logActivity("ERROR", error.message));