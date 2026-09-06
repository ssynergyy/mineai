require('dotenv').config();

const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const { plugin: pvp } = require('mineflayer-pvp');
const config = require('./config');
const { Agent } = require('./agent');
const { Security } = require('./security');
const { Automation } = require('./automation');
const { TaskManager } = require('./task');

console.log('Starting Mineflayer + llama.cpp agent...');
console.log(`Minecraft: ${config.minecraft.host}:${config.minecraft.port}`);
console.log(`Username:   ${config.minecraft.username}`);
console.log(`llama.cpp:  ${config.llama.baseUrl}`);

const bot = mineflayer.createBot(config.minecraft);
bot.loadPlugin(pathfinder);
bot.loadPlugin(pvp);
bot.tasks = new TaskManager();

let agent;
let security;
let automation;
let automationTimer;
let protectionTimer;
let securityScanTimer;
let securityCombatTimer;
const recentRaw = new Map();

function hardStop(reason = 'manual stop') {
  bot.tasks.cancel(reason);
  try { bot.pvp.stop(); } catch {}
  try { bot.pathfinder.setGoal(null); } catch {}
  try { bot.clearControlStates(); } catch {}
  if (agent) agent.cancel(reason);
  if (security) {
    security.currentProtected = null;
    security.stopCombat();
  }
  console.log(`[bot] ALL TASKS STOPPED: ${reason}`);
}

bot.once('spawn', () => {
  const movements = new Movements(bot);
  movements.canDig = true;
  movements.allow1by1towers = false;
  bot.pathfinder.setMovements(movements);

  security = new Security(bot, config);
  bot.security = security;
  automation = new Automation(bot, config);
  agent = new Agent(bot);

  automationTimer = setInterval(() => { void automation?.tick(); }, 2500);
  protectionTimer = setInterval(() => security?.maintainProtectedFollow(), 1000);
  securityScanTimer = setInterval(() => security?.scanPlayers(), 1000);
  securityCombatTimer = setInterval(() => security?.maintainEmergency(), 250);
  bot.agentQueueLength = 0;
  bot.agent = agent;

  console.log(`[bot] Spawned at ${bot.entity.position}`);
  console.log('[bot] AI agent ready.');
  console.log(`[bot] Persona loaded: ${config.persona.length} chars`);
});

function passwordCommand(text) {
  const password = config.command.password;
  if (!password) return null;
  const escaped = password.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'i');
  const match = re.exec(String(text));
  if (!match) return null;
  return String(text).slice(match.index + match[0].length).trim() || null;
}

function extractCommand(text, trustedUsername = '') {
  const lower = text.toLowerCase();
  const prefix = bot.username.toLowerCase();
  if (lower.startsWith('bot,') || lower.startsWith('bot:')) return text.replace(/^bot\s*[:,]\s*/i, '').trim();
  if (lower.startsWith(prefix + ' ')) return text.slice(bot.username.length).trim();
  if (trustedUsername && security?.isElite(trustedUsername)) return text.trim();
  return null;
}

function dispatch(username, message, channel = 'chat') {
  if (!agent || !message) return;
  const text = String(message).trim();
  if (!text) return;

  if (text.toLowerCase() === '!stop') {
    hardStop(`${username} issued !stop`);
    return;
  }

  if (security?.permissionMessage(username, text)) return;

  // Any username containing EliteSynergy is locally trusted and bypasses the password.
  const ownerTrusted = security?.isElite(username) === true;
  if (ownerTrusted) {
    const command = extractCommand(text, username);
    if (command) agent.handleUser(command, username, { channel, trusted: true });
    return;
  }

  const authenticated = passwordCommand(text);
  if (authenticated) {
    agent.handleUser(authenticated, username, { channel, trusted: true });
    return;
  }

  const command = extractCommand(text, username);
  if (command) agent.handleUser(command, username, { channel, trusted: false });
}

bot.on('chat', (username, message) => {
  if (username === bot.username) return;
  dispatch(username, message, 'chat');
});

bot.on('whisper', (username, message) => {
  if (username === bot.username) return;
  dispatch(username, message, 'whisper');
});

// Raw fallback for rank/mod/plugin chat. Owner-containing raw messages are trusted locally.
bot.on('messagestr', message => {
  const text = String(message || '').trim();
  if (!text || text === bot.username) return;
  if (text.toLowerCase() === '!stop') { hardStop('raw !stop'); return; }
  if (!agent || !security) return;
  const rawKey = text.toLowerCase();
  const previous = recentRaw.get(rawKey) || 0;
  if (Date.now() - previous < 1500) return;
  recentRaw.set(rawKey, Date.now());
  if (recentRaw.size > 100) {
    const cutoff = Date.now() - 5000;
    for (const [k, t] of recentRaw) if (t < cutoff) recentRaw.delete(k);
  }

  const ownerEscaped = security.owner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ownerMatch = text.match(new RegExp(`\\b[^\\s]*${ownerEscaped}[^\\s]*\\b`, 'i'));
  if (ownerMatch) {
    const ownerToken = ownerMatch[0];
    const idx = text.toLowerCase().indexOf(ownerToken.toLowerCase());
    const after = text.slice(idx + ownerToken.length).trim().replace(/^[:>\-]+\s*/, '');
    if (after) dispatch(ownerToken, after, 'chat');
    return;
  }

  const authenticated = passwordCommand(text);
  if (authenticated) {
    const password = config.command.password;
    const before = text.slice(0, text.toLowerCase().indexOf(password.toLowerCase())).trim();
    const tokens = before.split(/[^A-Za-z0-9_\-]+/).filter(Boolean);
    const requester = tokens.length ? tokens[tokens.length - 1] : config.security.owner;
    agent.handleUser(authenticated, requester, { channel: 'chat', trusted: true });
  }
});

bot.on('entityHurt', (entity, source) => security?.onEntityHurt(entity, source));
bot.on('kicked', reason => console.log('[bot] Kicked:', reason));
bot.on('error', error => console.error('[bot] Error:', error));
bot.on('end', () => {
  hardStop('connection ended');
  if (automationTimer) clearInterval(automationTimer);
  if (protectionTimer) clearInterval(protectionTimer);
  if (securityScanTimer) clearInterval(securityScanTimer);
  if (securityCombatTimer) clearInterval(securityCombatTimer);
  console.log('[bot] Connection ended. Exiting.');
  process.exit(1);
});
