const { Vec3 } = require("vec3");
const { goals } = require("mineflayer-pathfinder");

function pos(p) {
  return { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) };
}

function itemSummary(item) {
  return {
    name: item.name,
    displayName: item.displayName,
    count: item.count
  };
}

function toolDefinitions() {
  return [
    {
      type: "function",
      function: {
        name: "get_state",
        description: "Get the bot's current position, health, food, dimension and time.",
        parameters: { type: "object", properties: {}, additionalProperties: false }
      }
    },
    {
      type: "function",
      function: {
        name: "get_inventory",
        description: "Get all non-empty inventory slots.",
        parameters: { type: "object", properties: {}, additionalProperties: false }
      }
    },
    {
      type: "function",
      function: {
        name: "get_nearby_entities",
        description: "List nearby players, mobs and other entities.",
        parameters: {
          type: "object",
          properties: { radius: { type: "number", default: 16 } },
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "find_blocks",
        description: "Find nearby blocks by Minecraft block name, such as oak_log, stone, iron_ore.",
        parameters: {
          type: "object",
          properties: {
            block: { type: "string" },
            maxDistance: { type: "number", default: 32 },
            count: { type: "number", default: 8 }
          },
          required: ["block"],
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "move_to",
        description: "Navigate to a Minecraft coordinate using mineflayer-pathfinder.",
        parameters: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
            radius: { type: "number", default: 1 }
          },
          required: ["x", "y", "z"],
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "follow_player",
        description: "Follow a named Minecraft player until another action replaces the path.",
        parameters: {
          type: "object",
          properties: { username: { type: "string" }, distance: { type: "number", default: 2 } },
          required: ["username"],
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "stop",
        description: "Stop pathfinding and movement.",
        parameters: { type: "object", properties: {}, additionalProperties: false }
      }
    },
    {
      type: "function",
      function: {
        name: "look_at",
        description: "Look at a world coordinate.",
        parameters: {
          type: "object",
          properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } },
          required: ["x", "y", "z"],
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "equip",
        description: "Equip an inventory item by name into hand, head, torso, legs or feet.",
        parameters: {
          type: "object",
          properties: {
            item: { type: "string" },
            destination: { type: "string", enum: ["hand", "head", "torso", "legs", "feet"] }
          },
          required: ["item", "destination"],
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "unequip",
        description: "Unequip an equipment slot.",
        parameters: {
          type: "object",
          properties: { destination: { type: "string", enum: ["hand", "head", "torso", "legs", "feet"] } },
          required: ["destination"],
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "dig",
        description: "Dig a specific nearby block coordinate.",
        parameters: {
          type: "object",
          properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } },
          required: ["x", "y", "z"],
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "place_block",
        description: "Place the held item against a nearby reference block face.",
        parameters: {
          type: "object",
          properties: {
            x: { type: "number" }, y: { type: "number" }, z: { type: "number" },
            dx: { type: "number", default: 0 },
            dy: { type: "number", default: 1 },
            dz: { type: "number", default: 0 }
          },
          required: ["x", "y", "z"],
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "craft",
        description: "Craft an item using a known Mineflayer recipe and available inventory.",
        parameters: {
          type: "object",
          properties: { item: { type: "string" }, count: { type: "number", default: 1 } },
          required: ["item"],
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "smelt",
        description: "Smelt an item using a nearby furnace. The bot must already have fuel and input.",
        parameters: {
          type: "object",
          properties: { input: { type: "string" }, count: { type: "number", default: 1 } },
          required: ["input"],
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "eat",
        description: "Eat a food item currently in inventory.",
        parameters: {
          type: "object",
          properties: { item: { type: "string" } },
          required: ["item"],
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "attack",
        description: "Attack a nearby entity by entity id.",
        parameters: {
          type: "object",
          properties: { entityId: { type: "number" } },
          required: ["entityId"],
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "chat",
        description: "Send a Minecraft chat message.",
        parameters: {
          type: "object",
          properties: { message: { type: "string" } },
          required: ["message"],
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "wait",
        description: "Wait for a short amount of time, useful after an action changes the world.",
        parameters: {
          type: "object",
          properties: { milliseconds: { type: "number", default: 1000 } },
          additionalProperties: false
        }
      }
    }
  ];
}

function findItem(bot, name) {
  const target = String(name).toLowerCase();
  return bot.inventory.items().find(i =>
    i.name.toLowerCase() === target ||
    i.displayName.toLowerCase() === target
  );
}

async function runTool(bot, name, args) {
  switch (name) {
    case "get_state":
      return {
        username: bot.username,
        position: pos(bot.entity.position),
        health: bot.health,
        food: bot.food,
        saturation: bot.foodSaturation,
        dimension: bot.game?.dimension,
        time: bot.time?.timeOfDay,
        raining: bot.isRaining
      };

    case "get_inventory":
      return bot.inventory.items().map(itemSummary);

    case "get_nearby_entities": {
      const radius = Math.max(1, Number(args.radius ?? 16));
      return Object.values(bot.entities)
        .filter(e => e !== bot.entity && e.position && bot.entity.position.distanceTo(e.position) <= radius)
        .map(e => ({
          id: e.id,
          type: e.type,
          name: e.username || e.name || e.displayName || e.mobType,
          position: pos(e.position),
          distance: Number(bot.entity.position.distanceTo(e.position).toFixed(2)),
          health: e.health ?? null
        }));
    }

    case "find_blocks": {
      const block = bot.registry.blocksByName[String(args.block)];
      if (!block) throw new Error(`Unknown block name: ${args.block}`);
      const positions = bot.findBlocks({
        matching: block.id,
        maxDistance: Number(args.maxDistance ?? 32),
        count: Number(args.count ?? 8)
      });
      return positions.map(pos);
    }

    case "move_to": {
      const target = new Vec3(Number(args.x), Number(args.y), Number(args.z));
      const radius = Number(args.radius ?? 1);
      bot.pathfinder.setGoal(new goals.GoalNear(target.x, target.y, target.z, radius));
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error("Pathfinding timed out after 60 seconds"));
        }, 60000);
        const done = () => { cleanup(); resolve(); };
        const fail = () => { cleanup(); reject(new Error("Pathfinder could not reach the target")); };
        const cleanup = () => {
          clearTimeout(timeout);
          bot.removeListener("goal_reached", done);
          bot.removeListener("path_update", onPathUpdate);
        };
        const onPathUpdate = result => {
          if (result.status === "noPath") fail();
        };
        bot.once("goal_reached", done);
        bot.on("path_update", onPathUpdate);
      });
      return { reached: true, position: pos(bot.entity.position) };
    }

    case "follow_player": {
      const player = bot.players[String(args.username)];
      if (!player?.entity) throw new Error(`Player ${args.username} is not nearby/loaded`);
      bot.pathfinder.setGoal(new goals.GoalFollow(player.entity, Number(args.distance ?? 2)), true);
      return { following: args.username };
    }

    case "stop":
      bot.pathfinder.setGoal(null);
      bot.clearControlStates();
      return { stopped: true };

    case "look_at":
      await bot.lookAt(new Vec3(Number(args.x), Number(args.y), Number(args.z)), true);
      return { lookingAt: { x: args.x, y: args.y, z: args.z } };

    case "equip": {
      const item = findItem(bot, args.item);
      if (!item) throw new Error(`Item not found: ${args.item}`);
      await bot.equip(item, args.destination);
      return { equipped: itemSummary(item), destination: args.destination };
    }

    case "unequip":
      await bot.unequip(args.destination);
      return { unequipped: args.destination };

    case "dig": {
      const block = bot.blockAt(new Vec3(Number(args.x), Number(args.y), Number(args.z)));
      if (!block || block.name === "air") throw new Error("No diggable block at that position");
      await bot.dig(block);
      return { dug: block.name, position: pos(block.position) };
    }

    case "place_block": {
      const reference = bot.blockAt(new Vec3(Number(args.x), Number(args.y), Number(args.z)));
      if (!reference) throw new Error("Reference block not loaded");
      const held = bot.heldItem;
      if (!held) throw new Error("Nothing is held");
      const face = new Vec3(Number(args.dx ?? 0), Number(args.dy ?? 1), Number(args.dz ?? 0));
      await bot.placeBlock(reference, face);
      return { placed: held.name };
    }

    case "craft": {
      const item = bot.registry.itemsByName[String(args.item)];
      if (!item) throw new Error(`Unknown item: ${args.item}`);
      const recipes = bot.recipesFor(item.id, null, 1, null);
      if (!recipes.length) throw new Error(`No available recipe for ${args.item}`);
      const count = Math.max(1, Number(args.count ?? 1));
      await bot.craft(recipes[0], count, null);
      return { crafted: args.item, count };
    }

    case "smelt": {
      const furnaceBlock = bot.findBlock({
        matching: b => b.name === "furnace" || b.name === "blast_furnace",
        maxDistance: 16
      });
      if (!furnaceBlock) throw new Error("No furnace/blast furnace found nearby");
      const input = findItem(bot, args.input);
      if (!input) throw new Error(`Input not found: ${args.input}`);
      const furnace = await bot.openFurnace(furnaceBlock);
      try {
        await furnace.putInput(input.type, null, Math.min(input.count, Number(args.count ?? 1)));
        await new Promise(r => setTimeout(r, 500));
        return { furnace: "input inserted", input: args.input };
      } finally {
        furnace.close();
      }
    }

    case "eat": {
      const item = findItem(bot, args.item);
      if (!item) throw new Error(`Food not found: ${args.item}`);
      await bot.equip(item, "hand");
      await bot.consume();
      return { ate: args.item };
    }

    case "attack": {
      const entity = bot.entities[Number(args.entityId)];
      if (!entity) throw new Error(`Entity ${args.entityId} not found`);
      bot.attack(entity);
      return { attacked: { id: entity.id, name: entity.name || entity.username || entity.mobType } };
    }

    case "chat":
      bot.chat(String(args.message));
      return { sent: String(args.message) };

    case "wait": {
      const ms = Math.min(10000, Math.max(0, Number(args.milliseconds ?? 1000)));
      await new Promise(r => setTimeout(r, ms));
      return { waitedMs: ms };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

module.exports = { toolDefinitions, runTool };
