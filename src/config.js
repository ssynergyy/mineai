require("dotenv").config();

function number(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = {
  minecraft: {
    host: process.env.MC_HOST || "localhost",
    port: number("MC_PORT", 25565),
    username: process.env.MC_USERNAME || "05SynergyPvlls",
    version: process.env.MC_VERSION || undefined
  },
  llama: {
    baseUrl: (process.env.LLAMA_URL || "http://127.0.0.1:11111/v1").replace(/\/+$/, ""),
    apiKey: process.env.LLAMA_API_KEY || "no-key-required",
    model: process.env.LLAMA_MODEL || ""
  },
  agent: {
    maxSteps: number("AGENT_MAX_STEPS", 20),
    temperature: number("AGENT_TEMPERATURE", 0.2),
    maxTokens: number("AGENT_MAX_TOKENS", 700),
    observationRadius: number("AGENT_OBSERVATION_RADIUS", 16)
  }
};
