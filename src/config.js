const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

function number(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function list(name) {
  return String(process.env[name] || '').split(',').map(s => s.trim()).filter(Boolean);
}

function loadPersona() {
  const file = path.join(process.cwd(), 'persona.env');
  const fallback = `You control a real Minecraft bot.\nAct autonomously through tools; never merely describe actions that tools can perform.\nBe practical, persistent, and verify results after actions.\nUse the current requester name when the user says “me”.\nNever intentionally attack a player whose name contains EliteSynergy.\nFriendly and hostile lists are maintained by the owner through in-game instructions.\nThe protected player list is runtime-only and is managed in-game; protected players must be followed and defended by the local security system.\nWhen asked for resources, gather them and deliver them to the requester.\nFor crafting, prefer nearby crafting tables when a 3x3 recipe requires one.\nFor furnaces, smokers, and blast furnaces, supply both input and fuel and verify the result.\nFor enchanting, choose the requested enchantment or the best available option and verify XP/lapis/item requirements.\nFor anvils, use the requested rename/merge operation and verify the output.\nFor villagers, inspect trades before trading and report the selected trade.\nFor hopper delivery, physically move to the hopper and drop items so the hopper can collect them.\nPatrols may contain any number of points; loops=0 means forever until stopped.\nUse attack_entity for live entity combat and let the local security layer handle emergency defense.\n!stop is handled locally and bypasses the AI completely.`;
  try {
    if (!fs.existsSync(file)) return fallback;
    const parsed = dotenv.parse(fs.readFileSync(file));
    const prompt = parsed.PERSONA_SYSTEM_PROMPT;
    if (!prompt) return fallback;
    return prompt.replace(/\\n/g, '\n');
  } catch (err) {
    console.warn(`[config] Could not load persona.env: ${err.message}`);
    return fallback;
  }
}

module.exports = {
  minecraft: {
    host: process.env.MC_HOST || 'localhost',
    port: number('MC_PORT', 25565),
    username: process.env.MC_USERNAME || '05SynergyPvlls',
    version: process.env.MC_VERSION || undefined
  },
  llama: {
    baseUrl: (process.env.LLAMA_URL || 'http://127.0.0.1:11111/v1').replace(/\/+$/, ''),
    apiKey: process.env.LLAMA_API_KEY || 'no-key-required',
    model: process.env.LLAMA_MODEL || ''
  },
  command: {
    password: process.env.COMMAND_PASSWORD || ''
  },
  security: {
    enabled: bool('SECURITY_ENABLED', true),
    owner: process.env.SECURITY_OWNER || 'EliteSynergy',
    friendly: list('FRIENDLY_PLAYERS'),
    hostile: list('HOSTILE_PLAYERS')
  },
  automation: {
    autoEat: bool('AUTO_EAT', true),
    autoEquipArmor: bool('AUTO_EQUIP_ARMOR', true)
  },
  persona: loadPersona(),
  agent: {
    maxSteps: number('AGENT_MAX_STEPS', 24),
    temperature: number('AGENT_TEMPERATURE', 0.2),
    maxTokens: number('AGENT_MAX_TOKENS', 900),
    observationRadius: number('AGENT_OBSERVATION_RADIUS', 20)
  }
};
