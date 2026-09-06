require('dotenv').config();

const crypto = require('crypto');
const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const { plugin: pvp } = require('mineflayer-pvp');
const config = require('./config');
const { Agent } = require('./agent');

console.log('Starting Mineflayer + llama.cpp agent...');
console.log(`Minecraft: ${config.minecraft.host}:${config.minecraft.port}`);
console.log(`Username:   ${config.minecraft.username}`);
console.log(`llama.cpp:  ${config.llama.baseUrl}`);
console.log(`Command password: ${config.command.password ? 'configured' : 'NOT CONFIGURED'}`);

if (!config.command.password) {
  console.warn('[auth] COMMAND_PASSWORD is empty. Password-authenticated modded chat commands are disabled.');
}

const bot = mineflayer.createBot(config.minecraft);
bot.loadPlugin(pathfinder);
bot.loadPlugin(pvp);

let agent;

function timingSafeEqual(a, b) {
  const aa = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function stripFormatting(text) {
  return String(text || '')
    .replace(/[\u00a7&][0-9a-fk-or]/gi, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePasswordCommand(raw) {
  const password = config.command.password;
  if (!password) return null;
  const text = stripFormatting(raw);
  if (!text) return null;

  // Password must be a standalone token. This prevents "mypasswordXYZ" from authenticating.
  const escaped = password.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'i');
  const match = re.exec(text);
  if (!match) return null;

  // Constant-time check against the exact matched token.
  const token = text.slice(match.index + match[1].length, match.index + match[1].length + password.length);
  if (!timingSafeEqual(token.toLowerCase(), password.toLowerCase())) return null;

  const before = text.slice(0, match.index).trim();
  const after = text.slice(match.index + match[0].length).trim();
  if (!after) return null;

  // In rank-heavy formats, the token immediately before the password is commonly the username.
  // Use it only as the requester for "me"; the whole rank prefix is never sent to the model.
  const beforeTokens = before.split(/\s+/).filter(Boolean);
  const requester = beforeTokens.length ? beforeTokens[beforeTokens.length - 1].replace(/^[<\[({]+|[>\])}]+$/g, '') : null;

  return { command: after, requester: requester || config.command.defaultPlayer || 'player' };
}

function handleCommand(command, username, type) {
  if (!agent || !command) return;
  agent.handleUser(command, username || 'player', { type, username: username || undefined });
}

bot.once('spawn', () => {
  const movements = new Movements(bot);
  movements.canDig = true;
  movements.allow1by1towers = false;
  bot.pathfinder.setMovements(movements);
  agent = new Agent(bot);

  console.log(`[bot] Spawned at ${bot.entity.position}`);
  console.log('[bot] AI agent ready.');
  console.log('[bot] PVP plugin loaded.');
});

// Normal Mineflayer chat/whisper handling.
bot.on('chat', (username, message) => {
  if (username === bot.username) return;
  const text = String(message || '').trim();
  if (!text) return;

  const lower = text.toLowerCase();
  const prefix = bot.username.toLowerCase();
  if (lower.startsWith('bot,') || lower.startsWith('bot:') || lower.startsWith(prefix + ' ')) {
    const command = text.replace(/^[^,: ]+[\s,:]+/i, '').trim();
    handleCommand(command, username, 'chat');
  }
});

bot.on('whisper', (username, message) => {
  if (username === bot.username) return;
  const text = String(message || '').trim();
  if (text) handleCommand(text, username, 'whisper');
});

// Raw server messages are important on rank/plugin-heavy servers. The password parser runs
// locally here, before the AI receives anything. We deliberately do not send the raw message.
bot.on('messagestr', (message, messagePosition) => {
  if (!config.command.password || !agent) return;
  const parsed = parsePasswordCommand(message);
  if (!parsed) return;

  console.log(`[auth] Accepted password command from ${parsed.requester || 'unknown'} via ${messagePosition || 'unknown'} message.`);
  handleCommand(parsed.command, parsed.requester, 'chat');
});

bot.on('kicked', reason => console.log('[bot] Kicked:', reason));
bot.on('error', error => console.error('[bot] Error:', error));
bot.on('end', reason => {
  console.log('[bot] Connection ended:', reason || 'unknown');
  process.exit(1);
});
