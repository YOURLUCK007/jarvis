const $ = (selector) => document.querySelector(selector);
const conversation = $("#conversation");
const input = $("#input");
const stage = $("#stage");
const stageText = $("#stageText");
const confirmation = $("#confirmation");
const activityLog = $("#activityLog");
let history = [];
let settings = { modelEnabled: true, speakResponses: true };
let pendingPlan = null;

function addMessage(role, content, meta = role === "user" ? "You" : "Jarvis") {
  const welcome = $(".welcome");
  if (welcome) welcome.remove();
  const item = document.createElement("div");
  item.className = `message ${role}`;
  item.innerHTML = `<span class="meta">${meta}</span>${escapeHtml(content)}`;
  conversation.appendChild(item);
  conversation.scrollTop = conversation.scrollHeight;
  history.push({ role, content });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function setStage(label, busy = false) {
  stageText.textContent = label;
  stage.classList.toggle("busy", busy);
}

function logActivity(type, text) {
  const row = document.createElement("div");
  row.className = "log-entry";
  row.innerHTML = `<time>${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time><b>${escapeHtml(type)}</b><span>${escapeHtml(text)}</span>`;
  activityLog.prepend(row);
}

function speak(text) {
  if (!settings.speakResponses || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.03;
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
      const preview = result.items.slice(0, 8).map((item) => `${item.type === "folder" ? "▣" : "□"} ${item.path}`).join("\n");
      addMessage("assistant", preview, "Matches");
    }
    if (result.path) logActivity("OUTPUT", result.path);
    if (result.ok) speak(text);
  });
}

async function submit(text) {
  const value = (text || input.value).trim();
  if (!value) return;
  input.value = "";
  addMessage("user", value);
  setStage("Understanding your request", true);
  $("#stopBtn").classList.remove("hidden");
  logActivity("INPUT", value);
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
    } else renderResults(response);
  } catch (error) {
    addMessage("assistant", `I couldn’t complete that: ${error.message}`);
    logActivity("ERROR", error.message);
  } finally {
    $("#stopBtn").classList.add("hidden");
    if (!pendingPlan) setStage("Standing by", false);
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
}

function cancelPlan() {
  pendingPlan = null;
  confirmation.classList.add("hidden");
  addMessage("assistant", "I left that action untouched.");
  setStage("Standing by", false);
}

async function runDiagnostics() {
  const container = $("#diagnostics");
  container.innerHTML = "<div class='diag'><div class='diag-top'>Running checks…</div></div>";
  const result = await window.jarvis.diagnostics();
  container.innerHTML = result.checks.map((item) => `<div class="diag"><div class="diag-top"><span>${escapeHtml(item.name)}</span><b class="${item.ok ? "ok" : "fail"}">${item.ok ? "PASS" : "CHECK"}</b></div><small>${escapeHtml(item.detail)}</small></div>`).join("");
}

function setupVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $("#micBtn");
  if (!SpeechRecognition) { mic.title = "Speech recognition is not available; use typing"; return; }
  const recognition = new SpeechRecognition();
  recognition.lang = navigator.language || "en-US";
  recognition.interimResults = true;
  recognition.onstart = () => { mic.classList.add("listening"); setStage("Listening…", true); };
  recognition.onend = () => { mic.classList.remove("listening"); if (!pendingPlan) setStage("Standing by", false); };
  recognition.onerror = (event) => { logActivity("VOICE", event.error); };
  recognition.onresult = (event) => {
    const transcript = Array.from(event.results).map((result) => result[0].transcript).join("");
    input.value = transcript;
    if (event.results[0].isFinal) submit(transcript);
  };
  mic.onclick = () => { try { recognition.start(); } catch { recognition.stop(); } };
}

function switchPanel(name) {
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.panel === name));
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("active-panel"));
  $(`#${name}Panel`).classList.add("active-panel");
}

async function loadSettings() {
  settings = { ...settings, ...(await window.jarvis.getSettings()) };
  $("#modelBaseUrl").value = settings.modelBaseUrl || "";
  $("#modelName").value = settings.modelName || "";
  $("#modelApiKey").value = settings.modelApiKey || "";
  $("#modelEnabled").checked = settings.modelEnabled !== false;
  $("#speakResponses").checked = settings.speakResponses !== false;
  $("#modelState").textContent = settings.modelApiKey ? "Configured" : "Not configured";
}

$("#composer").addEventListener("submit", (event) => { event.preventDefault(); submit(); });
input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } });
$("#stopBtn").onclick = async () => { await window.jarvis.stop(); setStage("Stopped", false); $("#stopBtn").classList.add("hidden"); };
document.querySelectorAll("[data-prompt]").forEach((button) => button.onclick = () => submit(button.dataset.prompt));
document.querySelectorAll(".nav-item").forEach((button) => button.onclick = () => switchPanel(button.dataset.panel));
$("#diagnosticsBtn").onclick = () => { switchPanel("diagnostics"); runDiagnostics(); };
$("#runDiagnostics").onclick = runDiagnostics;
$("#clearLog").onclick = () => { activityLog.innerHTML = ""; };
$("#saveSettings").onclick = async () => {
  settings = { ...settings, modelBaseUrl: $("#modelBaseUrl").value.trim(), modelName: $("#modelName").value.trim(), modelApiKey: $("#modelApiKey").value.trim(), modelEnabled: $("#modelEnabled").checked, speakResponses: $("#speakResponses").checked };
  await window.jarvis.saveSettings(settings);
  $("#modelState").textContent = settings.modelApiKey ? "Configured" : "Not configured";
  logActivity("SETTINGS", "Settings saved locally.");
  setStage("Settings saved", false);
};
window.jarvis.onStage(({ label }) => { setStage(label, true); logActivity("STATUS", label); });
loadSettings();
setupVoice();