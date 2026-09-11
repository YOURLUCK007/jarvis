const { modelPlan } = require("./model");

const DANGEROUS_TOOLS = new Set(["delete_file", "run_command", "move_file", "copy_file", "rename_file"]);

function cleanPlan(plan, originalText) {
  if (!plan || !Array.isArray(plan.steps)) return null;
  const steps = plan.steps
    .filter((step) => step && typeof step.tool === "string")
    .map((step) => ({ tool: step.tool, input: step.input || {}, reason: step.reason || "" }));
  if (!steps.length) return null;
  return {
    type: "plan",
    summary: plan.summary || `Working on: ${originalText}`,
    steps,
    requiresConfirmation: steps.some((step) => DANGEROUS_TOOLS.has(step.tool))
  };
}

function pathFromName(name) {
  const trimmed = name.trim().replace(/^["']|["']$/g, "");
  if (/^(downloads?|documents?|desktop|home)$/i.test(trimmed)) return trimmed.toLowerCase();
  return trimmed;
}

function fallbackPlan(text) {
  const original = text.trim();
  const lower = original.toLowerCase();
  if (!original) return { type: "plan", summary: "Say a command or type a question.", steps: [{ tool: "respond", input: { message: "I’m listening." } }], requiresConfirmation: false };
  if (/^(stop|cancel|abort|never mind|nevermind)\b/.test(lower)) return { type: "cancel", summary: "Stopping", steps: [] };
  let match;
  if ((match = lower.match(/(?:go to|open|visit|navigate to)\s+(https?:\/\/\S+|[a-z0-9.-]+\.[a-z]{2,})/i))) {
    const url = match[1].startsWith("http") ? match[1] : `https://${match[1]}`;
    return cleanPlan({ summary: `Opening ${url}`, steps: [{ tool: "open_url", input: { url } }] }, original);
  }
  if ((match = original.match(/(?:search(?: the web)?|look up|find online)\s+(?:for\s+)?(.+)/i))) {
    return cleanPlan({ summary: `Searching the web for “${match[1]}”`, steps: [{ tool: "search_web", input: { query: match[1] } }] }, original);
  }
  if ((match = original.match(/(?:open|launch|start)\s+(?:my\s+)?(.+?)(?:\s+app)?$/i))) {
    return cleanPlan({ summary: `Opening ${match[1]}`, steps: [{ tool: "open_app", input: { name: match[1].trim() } }] }, original);
  }
  if ((match = original.match(/(?:open|show|go to)\s+(downloads?|documents?|desktop|home)(?:\s+folder)?/i))) {
    return cleanPlan({ summary: `Opening ${match[1]}`, steps: [{ tool: "open_path", input: { path: pathFromName(match[1]) } }] }, original);
  }
  if ((match = original.match(/(?:create|make)\s+(?:a\s+)?folder\s+(?:called|named)?\s*["']?(.+?)["']?$/i))) {
    return cleanPlan({ summary: `Creating folder ${match[1]}`, steps: [{ tool: "create_folder", input: { path: match[1].trim() } }] }, original);
  }
  if (/(?:take|capture).*(?:screenshot|screen shot)|screenshot/i.test(lower)) {
    return cleanPlan({ summary: "Capturing the current screen", steps: [{ tool: "take_screenshot", input: {} }] }, original);
  }
  if (/volume\s+(up|down)|(?:increase|decrease|mute).*(?:volume|sound)/i.test(original)) {
    const direction = /down|decrease|mute/i.test(original) ? "down" : "up";
    return cleanPlan({ summary: `${direction === "up" ? "Increasing" : "Decreasing"} system volume`, steps: [{ tool: "system_volume", input: { direction } }] }, original);
  }
  if ((match = original.match(/(?:calculate|compute|what is)\s+(.+)/i)) && /^[0-9+\-*/().%\s^]+$/.test(match[1])) {
    return cleanPlan({ summary: `Calculating ${match[1]}`, steps: [{ tool: "calculate", input: { expression: match[1] } }] }, original);
  }
  if ((match = original.match(/(?:find|search for)\s+(?:the\s+)?(?:file|files)?\s*(?:called|named)?\s*["']?(.+?)["']?(?:\s+in\s+(.+))?$/i))) {
    return cleanPlan({ summary: `Finding files matching ${match[1]}`, steps: [{ tool: "search_files", input: { query: match[1].trim(), path: match[2]?.trim() } }] }, original);
  }
  if ((match = original.match(/(?:delete|remove|erase)\s+(.+)/i))) {
    return cleanPlan({ summary: `Removing ${match[1]}`, steps: [{ tool: "delete_file", input: { path: match[1].trim() } }] }, original);
  }
  return cleanPlan({
    summary: "I need a model provider to plan that open-ended task.",
    steps: [{ tool: "respond", input: { message: `I can’t safely infer an action for “${original}” without a configured AI model. Add a model provider in Settings, or try a specific local action.` } }]
  }, original);
}

async function planRequest(text, { history = [], settings = {}, signal } = {}) {
  try {
    const remote = await modelPlan(text, history, settings, signal);
    const normalized = cleanPlan(remote, text);
    if (normalized) return normalized;
  } catch (error) {
    if (error.name === "AbortError") return { type: "cancel", summary: "Stopped", steps: [] };
  }
  return fallbackPlan(text);
}

module.exports = { planRequest, fallbackPlan, cleanPlan, DANGEROUS_TOOLS };