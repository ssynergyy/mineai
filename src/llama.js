const config = require("./config");
let cachedModel = null;

async function request(path, body, timeoutMs = config.llama.timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${config.llama.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.llama.apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`llama.cpp ${response.status}: ${text}`);
    }

    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function getModel() {
  if (config.llama.model) return config.llama.model;
  if (cachedModel) return cachedModel;

  const response = await fetch(`${config.llama.baseUrl}/models`, {
    headers: { "Authorization": `Bearer ${config.llama.apiKey}` }
  });

  if (!response.ok) {
    throw new Error(`Could not query llama.cpp models: ${response.status}`);
  }

  const data = await response.json();
  const model = data?.data?.[0]?.id;

  if (!model) throw new Error("llama.cpp returned no model from /v1/models");
  cachedModel = model;
  return model;
}

async function chat(messages, tools) {
  const model = await getModel();
  const body = {
    model,
    messages,
    temperature: config.agent.temperature,
    max_tokens: config.agent.maxTokens
  };
  if (Array.isArray(tools) && tools.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  return request("/chat/completions", body);
}

module.exports = { chat, getModel };
