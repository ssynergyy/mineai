const { chat } = require('./llama');
const { toolDefinitions, runTool } = require('./tools');
const config = require('./config');

const SYSTEM = `You are an autonomous Minecraft agent controlling a Mineflayer bot.

You have a real body in Minecraft. Perform the player's request with tools; do not merely explain what to do.

CORE RULES:
- Use tools to act.
- Use Pathfinder for navigation and NEVER navigate to a stale coordinate when a moving entity is the target.
- For a moving mob/entity, use get_nearby_entities, then follow_entity or attack_entity with its CURRENT entity id.
- attack_entity uses Mineflayer-PVP and follows the target while attacking. Do not substitute move_to + one punch for combat.
- For requests like "get me 16 oak logs", use collect_and_deliver with the requester's username. It mines, returns to that player and actually drops the items. Do not claim delivery unless the tool reports dropped items.
- For requests to give already-held items, use give_items_to_player.
- The requester's username is supplied outside the model as trusted task context. "me" means that requester.
- Observe before assuming. Verify important results.
- If a tool fails, reason about the error and try a sensible alternative.
- Never invent tool results.
- Stay focused on the latest request.
- Everything you do must happen through the supplied Minecraft tools.
- You cannot execute operating-system commands, JavaScript, shell commands, files, or arbitrary code.
- Keep chat replies short enough for Minecraft chat.

AUTHENTICATION NOTE: authentication/password checking is performed locally by Node.js before your request reaches this model. Never ask for, repeat, validate, or reason about a password. The password is not part of your context.`;

function observation(bot) {
  const nearby = Object.values(bot.entities)
    .filter(e => e !== bot.entity && e.position && bot.entity.position.distanceTo(e.position) <= config.agent.observationRadius)
    .slice(0, 40)
    .map(e => ({
      id: e.id,
      type: e.type,
      name: e.username || e.name || e.mobType,
      position: { x: Math.round(e.position.x), y: Math.round(e.position.y), z: Math.round(e.position.z) },
      distance: Number(bot.entity.position.distanceTo(e.position).toFixed(1)),
      health: e.health ?? null
    }));

  return {
    position: { x: Math.round(bot.entity.position.x), y: Math.round(bot.entity.position.y), z: Math.round(bot.entity.position.z) },
    health: bot.health,
    food: bot.food,
    inventory: bot.inventory.items().map(i => `${i.name} x${i.count}`),
    nearbyEntities: nearby,
    timeOfDay: bot.time?.timeOfDay,
    dimension: bot.game?.dimension
  };
}

class Agent {
  constructor(bot) {
    this.bot = bot;
    this.tools = toolDefinitions();
    this.messages = [{ role: 'system', content: SYSTEM }];
    this.busy = false;
  }

  async handleUser(text, username = 'player', reply = {}) {
    if (this.busy) {
      await this.reply(reply, "I'm still working on the previous task.");
      return;
    }

    this.busy = true;
    try {
      this.messages.push({
        role: 'user',
        content: `[Trusted requester: ${username}] [Reply channel: ${reply.type || 'chat'}]\nRequest: ${text}\n\nCurrent observation:\n${JSON.stringify(observation(this.bot))}`
      });

      if (this.messages.length > 31) this.messages = [this.messages[0], ...this.messages.slice(-30)];

      for (let step = 0; step < config.agent.maxSteps; step++) {
        const response = await chat(this.messages, this.tools);
        const message = response?.choices?.[0]?.message;
        if (!message) throw new Error('llama.cpp returned no assistant message');
        this.messages.push(message);

        const calls = message.tool_calls || [];
        if (!calls.length) {
          const output = typeof message.content === 'string' ? message.content.trim() : '';
          if (output) await this.reply(reply, output.slice(0, 256));
          return output || 'Done.';
        }

        for (const call of calls) {
          const name = call.function?.name;
          let args = {};
          try { args = JSON.parse(call.function?.arguments || '{}'); } catch { args = {}; }

          let result;
          try { result = await runTool(this.bot, name, args); }
          catch (error) { result = { error: error.message }; }

          this.messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        }

        this.messages.push({
          role: 'user',
          content: `Tool round ${step + 1} complete. Fresh world observation:\n${JSON.stringify(observation(this.bot))}`
        });
      }

      await this.reply(reply, 'I hit my action limit before finishing the task.');
    } catch (error) {
      console.error('[agent]', error);
      await this.reply(reply, `Agent error: ${error.message}`.slice(0, 256));
    } finally {
      this.busy = false;
    }
  }

  async reply(reply, text) {
    const clean = String(text).replace(/\s+/g, ' ').trim().slice(0, 256);
    if (!clean) return;
    if (reply.type === 'whisper' && reply.username) this.bot.whisper(reply.username, clean);
    else this.bot.chat(clean);
  }
}

module.exports = { Agent };
