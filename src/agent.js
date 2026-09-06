const { chat } = require('./llama');
const { toolDefinitions, runTool } = require('./tools');
const config = require('./config');

function observation(bot) {
  return {
    position: { x: Math.round(bot.entity.position.x), y: Math.round(bot.entity.position.y), z: Math.round(bot.entity.position.z) },
    health: bot.health,
    maxHealth: bot.maxHealth,
    food: bot.food,
    saturation: bot.foodSaturation,
    inventory: bot.inventory.items().map(i => `${i.name} x${i.count}`),
    nearbyEntities: Object.values(bot.entities).filter(e => e !== bot.entity && e.position && bot.entity.position.distanceTo(e.position) <= config.agent.observationRadius).slice(0, 40).map(e => ({
      id: e.id,
      type: e.type,
      name: e.username || e.name || e.displayName,
      position: { x: Math.round(e.position.x), y: Math.round(e.position.y), z: Math.round(e.position.z) },
      health: e.health ?? null
    })),
    players: Object.keys(bot.players || {}),
    lists: bot.security?.lists() || null,
    timeOfDay: bot.time?.timeOfDay,
    dimension: bot.game?.dimension
  };
}

const CORE = `ACTUAL BOT CAPABILITIES:
- Use tools to act; do not merely explain what could be done.
- The bot can dig, place blocks, craft with 2x2 or a crafting table, use furnace/smoker/blast furnace, use enchantment tables, use anvils, and trade with villagers.
- The bot can drop items onto hoppers, deliver items to players, follow entities, patrol arbitrary coordinate lists, and fight using live entity tracking.
- Automatic survival is handled locally: auto-eat when hunger is below half (or when damaged and there is room to eat), auto-equip better armor, and report when no food remains. The bot does NOT auto-hunt animals.
- The local security layer follows protected players and attacks anything that hurts them; it also defends the bot against mobs/attackers. It auto-switches to the best available weapon.
- NEVER intentionally attack a player whose username contains EliteSynergy. This applies even if the name is something like idddEliteSynergygfse.
- Friendly, hostile, and protected player lists are maintained through manage_player_list. Protected players are NOT configured in .env.
- Hostile-list players cause the local security layer to ask an EliteSynergy-containing owner for permission before intentional attack. Owner replies are \"yes PlayerName\" or \"no PlayerName\".
- If asked to protect a player, add them to the protected list; the local security layer then follows and defends them.
- The requester is explicitly supplied in each user message. When the user says \"me\", use that requester.
- When a request comes from an EliteSynergy-containing username, it is locally trusted and does not require COMMAND_PASSWORD.
- Whisper in -> whisper out. !stop is local and bypasses the AI entirely.
- Verify tool results before claiming success. Never invent results. Never execute shell commands, Node.js, JavaScript, or OS commands.`;

const SYSTEM = `${config.persona}\n\n${CORE}`;

class Agent {
  constructor(bot) {
    this.bot = bot;
    this.tools = toolDefinitions();
    this.messages = [{ role: 'system', content: SYSTEM }];
    this.busy = false;
    this.cancelled = false;
  }

  cancel(reason = 'cancelled') {
    this.cancelled = true;
    try { this.bot.pvp?.stop(); } catch {}
    try { this.bot.pathfinder?.setGoal(null); } catch {}
    try { this.bot.clearControlStates(); } catch {}
    console.log(`[agent] cancelled: ${reason}`);
  }

  async handleUser(text, username = 'player', context = { channel: 'chat', trusted: false }) {
    if (this.busy) {
      if (context.channel === 'whisper') this.bot.whisper(username, "I'm still working on the previous task.");
      else this.bot.chat("I'm still working on the previous task.");
      return;
    }

    this.cancelled = false;
    this.busy = true;
    const reply = msg => {
      if (!msg) return;
      if (context.channel === 'whisper') this.bot.whisper(username, String(msg).slice(0, 256));
      else this.bot.chat(String(msg).slice(0, 256));
    };

    try {
      this.messages.push({
        role: 'user',
        content: `[Requester: ${username}] [Trusted: ${Boolean(context.trusted)}] [Channel: ${context.channel}] ${text}\nObservation:\n${JSON.stringify(observation(this.bot))}`
      });
      if (this.messages.length > 35) this.messages = [this.messages[0], ...this.messages.slice(-34)];

      const taskGeneration = this.bot.tasks.generation;
      for (let step = 0; step < config.agent.maxSteps; step++) {
        if (this.cancelled || this.bot.tasks.generation !== taskGeneration) throw new Error('Task cancelled');
        const response = await chat(this.messages, this.tools);
        if (this.cancelled || this.bot.tasks.generation !== taskGeneration) throw new Error('Task cancelled');
        const message = response?.choices?.[0]?.message;
        if (!message) throw new Error('llama.cpp returned no assistant message');
        this.messages.push(message);
        const calls = message.tool_calls || [];
        if (!calls.length) { reply(message.content?.trim() || 'Done.'); return; }

        for (const call of calls) {
          if (this.cancelled || this.bot.tasks.generation !== taskGeneration) throw new Error('Task cancelled');
          let args = {};
          try { args = JSON.parse(call.function?.arguments || '{}'); } catch {}
          let result;
          try { result = await runTool(this.bot, call.function.name, args); }
          catch (e) { result = { error: e.message }; }
          this.messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        }
        this.messages.push({ role: 'user', content: `Fresh observation after tool round ${step + 1}:\n${JSON.stringify(observation(this.bot))}` });
      }
      reply('I hit my action limit before finishing the task.');
    } catch (e) {
      if (e.message !== 'Task cancelled') {
        console.error('[agent]', e);
        reply(`Agent error: ${e.message}`);
      }
    } finally {
      this.busy = false;
      this.cancelled = false;
    }
  }
}

module.exports = { Agent };
