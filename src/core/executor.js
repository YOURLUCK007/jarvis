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

async function executeStep(step, { signal } = {}) {
  if (signal?.aborted) return { ok: false, message: "Task cancelled." };
  const input = step.input || {};
  switch (step.tool) {
    case "respond": return { ok: true, message: input.message || "Done." };
    case "open_url":
      await shell.openExternal(input.url);
      return { ok: true, message: `Opened ${input.url}.` };
    case "search_web": {
      const url = `https://www.google.com/search?q=${encodeURIComponent(input.query || "")}`;
      await shell.openExternal(url);
      return { ok: true, message: `Opened web results for “${input.query}”.` };
    }
    case "open_app": return { ok: true, message: await openApp(input.name) };
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
    case "run_command": {
      const result = await execFileAsync(process.platform === "win32" ? "cmd" : "sh", process.platform === "win32" ? ["/c", input.command] : ["-lc", input.command], { timeout: 30000, maxBuffer: 1024 * 1024 });
      return { ok: true, message: result.stdout || result.stderr || "Command completed.", output: `${result.stdout || ""}${result.stderr || ""}`.trim() };
    }
    default: return { ok: false, message: `The tool “${step.tool}” is not installed.` };
  }
}

async function executePlan(plan, { signal, emit: notify } = {}) {
  const results = [];
  for (let index = 0; index < plan.steps.length; index++) {
    if (signal?.aborted) break;
    const step = plan.steps[index];
    notify?.("assistant:stage", { stage: "processing", label: step.reason || `Running ${step.tool.replaceAll("_", " ")}` });
    try {
      results.push({ tool: step.tool, ...await executeStep(step, { signal }) });
    } catch (error) {
      results.push({ tool: step.tool, ok: false, message: error.code === "ENOENT" ? `I couldn’t find ${step.input?.path || step.input?.name || "that item"}.` : error.message });
    }
  }
  notify?.("assistant:stage", { stage: "complete", label: results.every((item) => item.ok) ? "Complete" : "Completed with an error" });
  return results;
}

async function getDiagnostics() {
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
  await check("Model provider", async () => { if (!process.env.MODEL_API_KEY) throw new Error("Not configured; local planner remains available."); }, process.env.MODEL_NAME || "not configured");
  await check("Shell access", () => execFileAsync(process.platform === "win32" ? "cmd" : "sh", process.platform === "win32" ? ["/c", "echo ok"] : ["-lc", "echo ok"]), "command execution available");
  return { platform: process.platform, checks };
}

module.exports = { executePlan, getDiagnostics, resolveUserPath, dangerousSystemPath, searchFiles };