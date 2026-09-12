const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { app, shell } = require("electron");

const execFileAsync = promisify(execFile);
const HOME = os.homedir();
const ALIASES = {
  home: HOME,
  desktop: path.join(HOME, "Desktop"),
  downloads: path.join(HOME, "Downloads"),
  documents: path.join(HOME, "Documents"),
  pictures: path.join(HOME, "Pictures")
};

function resolveUserPath(value = "") {
  let candidate = String(value).trim().replace(/^["']|["']$/g, "");
  if (!candidate) return HOME;
  const alias = ALIASES[candidate.toLowerCase()];
  if (alias) return alias;
  if (candidate.startsWith("~")) candidate = path.join(HOME, candidate.slice(1));
  return path.resolve(candidate);
}

function dangerousSystemPath(target) {
  const normalized = path.resolve(target);
  if (process.platform === "win32") return /^[A-Z]:\\(?:Windows|Program Files|ProgramData)(?:\\|$)/i.test(normalized);
  return normalized === "/" || normalized === "/etc" || normalized.startsWith("/etc/") || normalized.startsWith("/usr/") || normalized.startsWith("/System/");
}

async function openApp(name) {
  const normalized = name.toLowerCase().trim();
  const aliases = {
    browser: process.platform === "darwin" ? "Safari" : process.platform === "win32" ? "msedge" : "xdg-open",
    chrome: process.platform === "darwin" ? "Google Chrome" : process.platform === "win32" ? "chrome" : "google-chrome",
    calculator: process.platform === "linux" ? "gnome-calculator" : "Calculator",
    terminal: process.platform === "darwin" ? "Terminal" : process.platform === "win32" ? "wt" : "x-terminal-emulator"
  };
  const command = aliases[normalized] || name.trim();
  if (process.platform === "darwin") {
    await execFileAsync("open", ["-a", command]);
  } else if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", command], { detached: true, stdio: "ignore" }).unref();
  } else {
    const child = spawn(command, [], { detached: true, stdio: "ignore" });
    child.unref();
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("spawn", resolve);
    });
  }
  return `Opened ${name}.`;
}

async function closeApp(name) {
  const target = String(name || "").trim();
  if (!target) throw new Error("No application name was provided.");
  if (process.platform === "darwin") {
    await execFileAsync("osascript", ["-e", `tell application "${target.replace(/"/g, '\\"')}" to quit`]);
  } else if (process.platform === "win32") {
    await execFileAsync("taskkill", ["/IM", target.endsWith(".exe") ? target : `${target}.exe`, "/T", "/F"]);
  } else {
    await execFileAsync("pkill", ["-f", target]);
  }
  return `Closed ${target}.`;
}

async function listDirectory(directory) {
  const target = resolveUserPath(directory || HOME);
  const entries = await fs.readdir(target, { withFileTypes: true });
  return entries.slice(0, 200).map((entry) => ({
    path: path.join(target, entry.name),
    name: entry.name,
    type: entry.isDirectory() ? "folder" : "file"
  }));
}

async function searchFiles(query, root) {
  const base = resolveUserPath(root || HOME);
  const wanted = String(query || "").toLowerCase();
  const matches = [];
  const queue = [base];
  let visited = 0;
  while (queue.length && visited < 3000 && matches.length < 100) {
    const current = queue.shift();
    visited++;
    let entries;
    try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && current === HOME) continue;
      const full = path.join(current, entry.name);
      if (entry.name.toLowerCase().includes(wanted)) {
        const stat = await fs.stat(full).catch(() => null);
        matches.push({ path: full, type: entry.isDirectory() ? "folder" : "file", size: stat?.size || 0, modified: stat?.mtime?.toISOString() });
      }
      if (entry.isDirectory() && !entry.isSymbolicLink()) queue.push(full);
    }
  }
  return matches;
}

async function searchWeb(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query || "")}`;
  const response = await fetch(url, { headers: { "User-Agent": "Jarvis Desktop Agent/1.0" } });
  if (!response.ok) throw new Error(`Web search returned HTTP ${response.status}.`);
  const html = await response.text();
  const results = [];
  const pattern = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html)) && results.length < 8) {
    const title = match[2].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").trim();
    const href = match[1].replace(/&amp;/g, "&");
    if (title && href) results.push({ title, url: href });
  }
  return results;
}

async function readTextFile(filePath) {
  const target = resolveUserPath(filePath);
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error("That path is not a file.");
  if (stat.size > 1024 * 1024) throw new Error("That file is larger than 1 MB; I did not load it into memory.");
  return { path: target, content: await fs.readFile(target, "utf8") };
}

async function setClipboard(text) {
  if (process.platform === "darwin") await execFileWithInput("pbcopy", [], String(text || ""));
  else if (process.platform === "win32") await execFileWithInput("powershell", ["-NoProfile", "-Command", "Set-Clipboard"], String(text || ""));
  else {
    try { await execFileWithInput("wl-copy", [], String(text || "")); }
    catch { await execFileWithInput("xclip", ["-selection", "clipboard"], String(text || "")); }
  }
}

function execFileWithInput(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(Object.assign(new Error(stderr || `Command exited with ${code}`), { code })));
    child.stdin.end(input);
  });
}

async function getClipboard() {
  if (process.platform === "darwin") return (await execFileAsync("pbpaste")).stdout;
  if (process.platform === "win32") return (await execFileAsync("powershell", ["-NoProfile", "-Command", "Get-Clipboard"])).stdout;
  try { return (await execFileAsync("wl-paste")).stdout; }
  catch { return (await execFileAsync("xclip", ["-selection", "clipboard", "-o"])).stdout; }
}

async function typeText(text) {
  const value = String(text || "");
  if (process.platform === "darwin") {
    await execFileAsync("osascript", ["-e", `tell application "System Events" to keystroke ${JSON.stringify(value)}`]);
  } else if (process.platform === "win32") {
    await execFileAsync("powershell", ["-NoProfile", "-Command", `$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys(${JSON.stringify(value)})`]);
  } else {
    await execFileAsync("xdotool", ["type", "--clearmodifiers", value]);
  }
  return "Text entered.";
}

async function pressKey(key) {
  const value = String(key || "").trim();
  if (!value) throw new Error("No key was provided.");
  if (process.platform === "darwin") {
    await execFileAsync("osascript", ["-e", `tell application "System Events" to key code ${value}`]);
  } else if (process.platform === "win32") {
    await execFileAsync("powershell", ["-NoProfile", "-Command", `$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys(${JSON.stringify(`{${value}}`)})`]);
  } else {
    await execFileAsync("xdotool", ["key", value]);
  }
  return `Pressed ${value}.`;
}

async function listProcesses() {
  const command = process.platform === "win32" ? ["tasklist", ["/FO", "CSV", "/NH"]] : ["ps", ["-eo", "pid=,comm=,args="]];
  const output = await execFileAsync(command[0], command[1]);
  return output.stdout.split(/\r?\n/).filter(Boolean).slice(0, 150).map((line) => line.trim());
}

async function takeScreenshot() {
  const output = path.join(app.getPath("pictures"), `jarvis-${Date.now()}.png`);
  await fs.mkdir(path.dirname(output), { recursive: true });
  if (process.platform === "darwin") await execFileAsync("screencapture", ["-x", output]);
  else if (process.platform === "win32") {
    const script = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('${output.replace(/'/g, "''")}')`;
    await execFileAsync("powershell", ["-NoProfile", "-Command", script]);
  } else {
    try { await execFileAsync("gnome-screenshot", ["-f", output]); }
    catch { await execFileAsync("scrot", [output]); }
  }
  return { message: `Screenshot saved to ${output}.`, path: output };
}

async function executeStep(step, { signal, settings = {} } = {}) {
  if (signal?.aborted) return { ok: false, message: "Task cancelled." };
  const input = step.input || {};
  if (settings.computerControl === false && !["respond", "calculate", "search_web", "recall_memory"].includes(step.tool)) {
    return { ok: false, message: "Computer control is disabled in Settings." };
  }
  if (settings.browserAutomation === false && ["open_url", "search_web"].includes(step.tool)) {
    return { ok: false, message: "Browser automation is disabled in Settings." };
  }
  if (settings.screenUnderstanding === false && ["take_screenshot", "inspect_screen"].includes(step.tool)) {
    return { ok: false, message: "Screen understanding is disabled in Settings." };
  }
  if (settings.terminalAccess !== true && step.tool === "run_command") {
    return { ok: false, message: "Terminal access is disabled in Settings." };
  }
  switch (step.tool) {
    case "respond": return { ok: true, message: input.message || "Done." };
    case "open_url":
      await shell.openExternal(input.url);
      return { ok: true, message: `Opened ${input.url}.` };
    case "search_web": {
      const results = await searchWeb(input.query);
      return {
        ok: true,
        message: results.length ? `Found ${results.length} current web results for “${input.query}”.` : "I couldn't find results for that search.",
        items: results
      };
    }
    case "open_app": return { ok: true, message: await openApp(input.name) };
    case "close_app": return { ok: true, message: await closeApp(input.name) };
    case "open_path": {
      const target = resolveUserPath(input.path);
      const error = await shell.openPath(target);
      return error ? { ok: false, message: error } : { ok: true, message: `Opened ${target}.`, path: target };
    }
    case "create_folder": {
      const target = resolveUserPath(input.path);
      await fs.mkdir(target, { recursive: true });
      return { ok: true, message: `Created folder ${target}.`, path: target };
    }
    case "create_file": {
      const target = resolveUserPath(input.path);
      if (dangerousSystemPath(target)) return { ok: false, message: "That location is protected." };
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, String(input.content || ""), { flag: "wx" });
      return { ok: true, message: `Created ${target}.`, path: target };
    }
    case "list_directory": {
      const items = await listDirectory(input.path);
      return { ok: true, message: `Found ${items.length} item${items.length === 1 ? "" : "s"}.`, items };
    }
    case "read_file": {
      const file = await readTextFile(input.path);
      return { ok: true, message: file.content || "The file is empty.", path: file.path, content: file.content };
    }
    case "file_info": {
      const target = resolveUserPath(input.path);
      const stat = await fs.stat(target);
      return { ok: true, message: `${target} is a ${stat.isDirectory() ? "folder" : "file"} modified ${stat.mtime.toLocaleString()}.`, path: target, size: stat.size };
    }
    case "search_files": {
      const matches = await searchFiles(input.query, input.path);
      return { ok: true, message: matches.length ? `Found ${matches.length} matching item${matches.length === 1 ? "" : "s"}.` : "No matching files found.", items: matches };
    }
    case "move_file": {
      const source = resolveUserPath(input.source), destination = resolveUserPath(input.destination);
      await fs.rename(source, destination);
      return { ok: true, message: `Moved ${source} to ${destination}.` };
    }
    case "copy_file": {
      const source = resolveUserPath(input.source), destination = resolveUserPath(input.destination);
      await fs.cp(source, destination, { recursive: true });
      return { ok: true, message: `Copied ${source} to ${destination}.` };
    }
    case "rename_file": {
      const source = resolveUserPath(input.source), destination = resolveUserPath(input.destination);
      await fs.rename(source, destination);
      return { ok: true, message: `Renamed ${source} to ${destination}.` };
    }
    case "delete_file": {
      const target = resolveUserPath(input.path);
      if (dangerousSystemPath(target)) return { ok: false, message: "That location is protected." };
      await fs.rm(target, { recursive: true, force: false });
      return { ok: true, message: `Removed ${target}.` };
    }
    case "take_screenshot": return { ok: true, ...(await takeScreenshot()) };
    case "inspect_screen": {
      const shot = await takeScreenshot();
      return { ok: true, message: `I captured the current screen at ${shot.path}. A vision-capable model can inspect this image when screen understanding is enabled.`, path: shot.path };
    }
    case "calculate": {
      const expression = String(input.expression || "").replace(/\^/g, "**");
      if (!/^[0-9+\-*/().%\s*]+$/.test(expression) || expression.length > 120) return { ok: false, message: "That calculation contains unsupported characters." };
      const value = Function(`"use strict"; return (${expression})`)();
      return { ok: true, message: `${input.expression} = ${value}` };
    }
    case "system_volume": {
      const direction = input.direction === "down" ? "-5%" : "+5%";
      if (process.platform === "linux") await execFileAsync("pactl", ["set-sink-volume", "@DEFAULT_SINK@", direction]);
      else if (process.platform === "darwin") await execFileAsync("osascript", ["-e", `set volume output volume ((output volume of (get volume settings)) ${direction === "+5%" ? "+" : "-"} 5)`]);
      else return { ok: false, message: "Volume controls need a Windows adapter in this environment." };
      return { ok: true, message: `Turned volume ${input.direction === "down" ? "down" : "up"}.` };
    }
    case "clipboard_set":
      await setClipboard(input.text);
      return { ok: true, message: "Clipboard updated." };
    case "clipboard_get":
      return { ok: true, message: await getClipboard() || "Clipboard is empty." };
    case "type_text":
      return { ok: true, message: await typeText(input.text) };
    case "press_key":
      return { ok: true, message: await pressKey(input.key) };
    case "list_processes":
      return { ok: true, message: "Here are the running processes.", items: await listProcesses() };
    case "stop_process": {
      const pid = String(input.pid || "");
      if (!/^\d+$/.test(pid)) return { ok: false, message: "A numeric process ID is required." };
      if (process.platform === "win32") await execFileAsync("taskkill", ["/PID", pid, "/T", "/F"]);
      else process.kill(Number(pid), "SIGTERM");
      return { ok: true, message: `Stopped process ${pid}.` };
    }
    case "remember":
      return { ok: true, message: `I can remember that when memory is enabled: ${input.fact || "nothing was provided"}.`, memory: input.fact || "" };
    case "recall_memory":
      return { ok: true, message: "Memory lookup is handled by the local conversation store." };
    case "run_command": {
      const result = await execFileAsync(process.platform === "win32" ? "cmd" : "sh", process.platform === "win32" ? ["/c", input.command] : ["-lc", input.command], { timeout: 30000, maxBuffer: 1024 * 1024 });
      return { ok: true, message: result.stdout || result.stderr || "Command completed.", output: `${result.stdout || ""}${result.stderr || ""}`.trim() };
    }
    default: return { ok: false, message: `The tool “${step.tool}” is not installed.` };
  }
}

async function executePlan(plan, { signal, emit: notify, settings = {} } = {}) {
  const results = [];
  for (let index = 0; index < plan.steps.length; index++) {
    if (signal?.aborted) break;
    const step = plan.steps[index];
    notify?.("assistant:activity", { type: "ACTION", text: `${step.tool.replaceAll("_", " ")}${step.reason ? ` — ${step.reason}` : ""}` });
    notify?.("assistant:stage", { stage: "processing", label: step.reason || `Running ${step.tool.replaceAll("_", " ")}` });
    try {
      const result = await executeStep(step, { signal, settings });
      results.push({ tool: step.tool, ...result });
      notify?.("assistant:activity", { type: result.ok ? "VERIFICATION" : "ERROR", text: result.message });
    } catch (error) {
      const message = error.code === "ENOENT" ? `I couldn’t find ${step.input?.path || step.input?.name || "that item"}.` : error.message;
      results.push({ tool: step.tool, ok: false, message });
      notify?.("assistant:activity", { type: "ERROR", text: message });
    }
  }
  const complete = results.every((item) => item.ok);
  notify?.("assistant:activity", { type: complete ? "COMPLETE" : "ERROR", text: complete ? "Task completed successfully." : "Task completed with an error." });
  notify?.("assistant:stage", { stage: "complete", label: complete ? "Complete" : "Completed with an error" });
  return results;
}

async function getDiagnostics(settings = {}) {
  const checks = [];
  const check = async (name, fn, detail) => {
    try { await fn(); checks.push({ name, ok: true, detail }); }
    catch (error) { checks.push({ name, ok: false, detail: error.message }); }
  };
  await check("Operating system", async () => {}, `${process.platform} ${os.release()}`);
  await check("Home directory", () => fs.access(HOME), HOME);
  await check("Pictures directory", () => fs.mkdir(path.join(HOME, "Pictures"), { recursive: true }), path.join(HOME, "Pictures"));
  await check("Internet", () => new Promise((resolve, reject) => {
    require("node:https").get("https://example.com", (response) => response.statusCode < 500 ? resolve() : reject(new Error(`HTTP ${response.statusCode}`))).on("error", reject).setTimeout(5000, () => reject(new Error("Timed out")));
  }), "example.com reachable");
  await check("Model provider", async () => {
    if (!settings.modelApiKey) throw new Error("Not configured; local planner remains available.");
  }, settings.modelName || process.env.MODEL_NAME || "not configured");
  await check("API key", async () => { if (!settings.modelApiKey && !process.env.MODEL_API_KEY) throw new Error("No key stored."); }, settings.modelApiKey ? "Stored in secure local storage" : "Not configured");
  await check("Screen capture", async () => {
    const probe = path.join(app.getPath("temp"), "jarvis-diagnostic.png");
    if (process.platform === "darwin") await execFileAsync("screencapture", ["-x", probe]);
    else if (process.platform === "win32") await execFileAsync("powershell", ["-NoProfile", "-Command", "Add-Type -AssemblyName System.Windows.Forms"]);
    else {
      try { await execFileAsync("gnome-screenshot", ["-f", probe]); }
      catch { await execFileAsync("scrot", [probe]); }
    }
    await fs.rm(probe, { force: true });
  }, "Native screen capture adapter");
  await check("Browser control", () => shell.openExternal("about:blank"), "Can open the default browser");
  await check("Terminal", () => execFileAsync(process.platform === "win32" ? "cmd" : "sh", process.platform === "win32" ? ["/c", "echo ok"] : ["-lc", "echo ok"]), "Command execution available");
  await check("Required dependencies", async () => {
    if (!process.versions.electron) throw new Error("Electron runtime unavailable.");
  }, `Electron ${process.versions.electron}`);
  return { platform: process.platform, checks };
}

module.exports = { executePlan, getDiagnostics, resolveUserPath, dangerousSystemPath, searchFiles, searchWeb, executeStep };