const SYSTEM_PROMPT = `You are JARVIS, a calm, concise, professional personal computer assistant. Sound natural and confident, never robotic or verbose.
You are the planning engine for a permissioned cross-platform computer agent.
Return ONLY valid JSON matching:
{"summary":"short human explanation","steps":[{"tool":"...","input":{},"reason":"..."}]}
Available tools:
open_url {url}, open_app {name}, close_app {name}, open_path {path}, list_directory {path?},
search_web {query}, search_files {query,path?,kind?}, read_file {path}, file_info {path},
create_folder {path}, create_file {path,content}, move_file {source,destination}, copy_file {source,destination},
rename_file {source,destination}, delete_file {path}, take_screenshot {}, inspect_screen {},
calculate {expression}, system_volume {direction}, clipboard_get {}, clipboard_set {text},
list_processes {}, stop_process {pid}, type_text {text}, press_key {key}, run_command {command},
remember {fact}, recall_memory {query}, respond {message}.
Use multiple steps for compound requests. Use natural language goals and paths; do not hard-code the user's examples.
Never claim a tool completed anything. The executor will report results. Prefer respond when the user is only asking a question.
Use run_command only when no safer native tool exists. Ask for confirmation through the plan for destructive, external, or terminal actions.`;

function getModelConfig(settings = {}) {
  return {
    baseUrl: settings.modelBaseUrl || process.env.MODEL_BASE_URL,
    apiKey: settings.modelApiKey || process.env.MODEL_API_KEY,
    model: settings.modelName || process.env.MODEL_NAME || "gpt-4o-mini"
  };
}

async function modelPlan(text, history, settings, signal) {
  const config = getModelConfig(settings);
  if (!config.baseUrl || !config.apiKey || settings.modelEnabled === false) return null;
  const endpoint = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.slice(-8).map((item) => ({ role: item.role === "assistant" ? "assistant" : "user", content: item.content })),
    { role: "user", content: text }
  ];
  const response = await fetch(endpoint, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, temperature: 0.1, response_format: { type: "json_object" }, messages })
  });
  if (!response.ok) throw new Error(`Model provider returned ${response.status}`);
  const body = await response.json();
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("Model provider returned no plan");
  return JSON.parse(content);
}

async function testModelConnection(settings = {}) {
  const config = getModelConfig(settings);
  if (!config.baseUrl || !config.apiKey) {
    return { ok: false, message: "Model connection failed: provider or API key is not configured." };
  }
  const endpoint = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        max_tokens: 8,
        messages: [{ role: "user", content: "Reply with OK." }]
      })
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return { ok: false, message: "Model connection failed: authentication error." };
      return { ok: false, message: `Model connection failed: provider returned HTTP ${response.status}.` };
    }
    return { ok: true, message: "Model connection successful.", model: config.model };
  } catch (error) {
    return { ok: false, message: `Model connection failed: ${error.message}` };
  }
}

module.exports = { modelPlan, testModelConnection, getModelConfig };