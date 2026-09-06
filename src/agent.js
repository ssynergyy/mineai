const { chat } = require("./llama");
const { toolDefinitions, runTool } = require("./tools");
const config = require("./config");

const SYSTEM = `You are an autonomous Minecraft agent controlling a Mineflayer bot.

You are not a chat-only assistant. You have a body in Minecraft and should actually perform tasks using tools.

RULES:
- Use tools to act. Do not merely describe what you would do.
- Use move_to for navigation; it uses Mineflayer Pathfinder.
- Observe the world before making assumptions.
- After important actions, verify the result with get_state, get_inventory, find_blocks, or nearby entities.
- Break complex tasks into smaller tool calls.
- If a tool fails, reason about the error and try another sensible approach.
- Never invent tool results.
- Stay focused on the player's latest request.
- You may use Minecraft chat when appropriate, but do not spam it.
- You cannot execute operating-system commands, JavaScript, shell commands, files, or arbitrary code.
- Everything you do must happen through the supplied Minecraft tools.

You are allowed to be proactive: gather resources, craft, explore, fight, build, follow players, manage inventory, etc., as long as Minecraft tools permit it.`;

function observation(bot) {
  const nearby = Object.values(bot.entities)
    .filter(e => e !== bot.entity && e.position && bot.entity.position.distanceTo(e.position) <= config.agent.observationRadius)
    .slice(0, 30)
    .map(e => ({
      id: e.id,
      type: e.type,
      name: e.username || e.name || e.mobType,
      position: {
        x: Math.round(e.position.x),
        y: Math.round(e.position.y),
        z: Math.round(e.position.z)
      }
    }));

  return {
    position: {
      x: Math.round(bot.entity.position.x),
      y: Math.round(bot.entity.position.y),
      z: Math.round(bot.entity.position.z)
    },
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
    this.messages = [
      { role: "system", content: SYSTEM }
    ];
    this.busy = false;
  }

  async handleUser(text, username = "player") {
    if (this.busy) {
      this.bot.chat("I'm still working on the previous task.");
      return;
    }

    this.busy = true;

    try {
      this.messages.push({
        role: "user",
        content: `[Minecraft player: ${username}] ${text}\n\nCurrent observation:\n${JSON.stringify(observation(this.bot))}`
      });

      // Keep long-running conversations bounded.
      if (this.messages.length > 31) {
        this.messages = [this.messages[0], ...this.messages.slice(-30)];
      }

      for (let step = 0; step < config.agent.maxSteps; step++) {
        const response = await chat(this.messages, this.tools);
        const message = response?.choices?.[0]?.message;

        if (!message) throw new Error("llama.cpp returned no assistant message");

        this.messages.push(message);

        const calls = message.tool_calls || [];
        if (!calls.length) {
          const text = message.content?.trim();
          if (text) this.bot.chat(text.slice(0, 256));
          return text || "Done.";
        }

        for (const call of calls) {
          const name = call.function?.name;
          let args = {};

          try {
            args = JSON.parse(call.function?.arguments || "{}");
          } catch {
            args = {};
          }

          let result;
          try {
            result = await runTool(this.bot, name, args);
          } catch (error) {
            result = { error: error.message };
          }

          this.messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result)
          });
        }

        // Give the model a fresh compact observation after each tool round.
        this.messages.push({
          role: "user",
          content: `Tool round ${step + 1} complete. Fresh world observation:\n${JSON.stringify(observation(this.bot))}`
        });
      }

      this.bot.chat("I hit my action limit before finishing the task.");
    } catch (error) {
      console.error("[agent]", error);
      this.bot.chat(`Agent error: ${error.message}`.slice(0, 256));
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { Agent };
