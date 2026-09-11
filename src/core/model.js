const SYSTEM_PROMPT = `You are the planning engine for Jarvis Desktop, a permissioned cross-platform computer agent.
Return ONLY valid JSON matching:
{"summary":"short human explanation","steps":[{"tool":"...","input":{},"reason":"..."}]}
Available tools:
open_url {url}, open_app {name}, open_path {path}, search_web {query}, search_files {query,path?,kind?},
create_folder {path}, move_file {source,destination}, copy_file {source,destination}, rename_file {source,destination},
delete_file {path}, take_screenshot {}, calculate {expression}, system_volume {direction}, run_command {command},
respond {message}.
Use multiple steps for compound requests. Use natural language goals and paths; do not hard-code the user's examples.
Never claim a tool completed anything. The executor will report results. Prefer respond when the user is only asking a question.
Use run_command only when no safer native tool exists.`;

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

module.exports = { modelPlan };