const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');

function pos(p) {
  return { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) };
}

function itemSummary(item) {
  return { name: item.name, displayName: item.displayName, count: item.count };
}

function toolDefinitions() {
  const fn = (name, description, properties = {}, required = []) => ({
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } }
  });

  return [
    fn('get_state', 'Get the bot current position, health, food, dimension and time.'),
    fn('get_inventory', 'Get all non-empty inventory slots.'),
    fn('get_nearby_entities', 'List nearby players, mobs and other entities.', {
      radius: { type: 'number', default: 16 }
    }),
    fn('find_blocks', 'Find nearby blocks by exact Minecraft block name.', {
      block: { type: 'string' }, maxDistance: { type: 'number', default: 32 }, count: { type: 'number', default: 8 }
    }, ['block']),
    fn('move_to', 'Navigate to a Minecraft coordinate using Pathfinder.', {
      x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' }, radius: { type: 'number', default: 1 }
    }, ['x', 'y', 'z']),
    fn('follow_player', 'Continuously follow a named Minecraft player.', {
      username: { type: 'string' }, distance: { type: 'number', default: 2 }
    }, ['username']),
    fn('follow_entity', 'Continuously follow a currently loaded entity by entity id. Use this for moving mobs/entities, not coordinates.', {
      entityId: { type: 'number' }, distance: { type: 'number', default: 2 }
    }, ['entityId']),
    fn('stop', 'Stop Pathfinder and PVP movement.'),
    fn('look_at', 'Look at a world coordinate.', {
      x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' }
    }, ['x', 'y', 'z']),
    fn('equip', 'Equip an inventory item into hand, head, torso, legs or feet.', {
      item: { type: 'string' }, destination: { type: 'string', enum: ['hand', 'head', 'torso', 'legs', 'feet'] }
    }, ['item', 'destination']),
    fn('unequip', 'Unequip an equipment slot.', {
      destination: { type: 'string', enum: ['hand', 'head', 'torso', 'legs', 'feet'] }
    }, ['destination']),
    fn('dig', 'Dig a specific nearby block coordinate.', {
      x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' }
    }, ['x', 'y', 'z']),
    fn('place_block', 'Place the held item against a nearby reference block face.', {
      x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
      dx: { type: 'number', default: 0 }, dy: { type: 'number', default: 1 }, dz: { type: 'number', default: 0 }
    }, ['x', 'y', 'z']),
    fn('craft', 'Craft an item using a known Mineflayer recipe.', {
      item: { type: 'string' }, count: { type: 'number', default: 1 }
    }, ['item']),
    fn('smelt', 'Insert an item into a nearby furnace/blast furnace. Fuel must already be available.', {
      input: { type: 'string' }, count: { type: 'number', default: 1 }
    }, ['input']),
    fn('eat', 'Eat a food item currently in inventory.', { item: { type: 'string' } }, ['item']),
    fn('attack_entity', 'Start Mineflayer-PVP against a currently loaded entity. PVP continuously follows the moving entity and attacks it until it dies, disappears, or the timeout is reached.', {
      entityId: { type: 'number' }, timeoutSeconds: { type: 'number', default: 30 }
    }, ['entityId']),
    fn('give_items_to_player', 'Go to the named player and drop requested inventory items at their feet. This is deterministic; use it to actually deliver mined items instead of merely saying you gave them.', {
      username: { type: 'string' }, item: { type: 'string' }, count: { type: 'number', default: 1 }
    }, ['username', 'item']),
    fn('collect_and_deliver', 'Mine a requested block type until the requested item count is collected, then return to the named player and drop the items. Prefer this for requests like "get me 16 oak logs".', {
      username: { type: 'string' }, block: { type: 'string' }, count: { type: 'number', default: 1 }, searchDistance: { type: 'number', default: 48 }
    }, ['username', 'block']),
    fn('chat', 'Send a public Minecraft chat message.', { message: { type: 'string' } }, ['message']),
    fn('wait', 'Wait for a short amount of time.', { milliseconds: { type: 'number', default: 1000 } })
  ];
}

function findItem(bot, name) {
  const target = String(name).toLowerCase().trim();
  return bot.inventory.items().find(i => i.name.toLowerCase() === target || i.displayName.toLowerCase() === target);
}

function findItems(bot, name) {
  const target = String(name).toLowerCase().trim();
  return bot.inventory.items().filter(i => i.name.toLowerCase() === target || i.displayName.toLowerCase() === target);
}

async function moveTo(bot, target, radius = 2, timeoutMs = 60000) {
  bot.pvp?.stop?.();
  bot.pathfinder.setGoal(new goals.GoalNear(target.x, target.y, target.z, radius));
  if (bot.entity.position.distanceTo(target) <= radius + 0.5) return;

  await new Promise((resolve, reject) => {
    let finished = false;
    const cleanup = () => {
      clearTimeout(timeout);
      bot.removeListener('goal_reached', onGoal);
      bot.removeListener('path_update', onPathUpdate);
    };
    const finish = (err) => {
      if (finished) return;
      finished = true;
      cleanup();
      err ? reject(err) : resolve();
    };
    const onGoal = () => finish();
    const onPathUpdate = result => {
      if (result?.status === 'noPath') finish(new Error('Pathfinder could not reach the target'));
    };
    const timeout = setTimeout(() => finish(new Error('Pathfinding timed out after 60 seconds')), timeoutMs);
    bot.once('goal_reached', onGoal);
    bot.on('path_update', onPathUpdate);
  });
}

async function dropMatchingItems(bot, itemName, count) {
  let remaining = Math.max(1, Math.floor(Number(count ?? 1)));
  let dropped = 0;

  while (remaining > 0) {
    const stack = findItems(bot, itemName)[0];
    if (!stack) break;
    const amount = Math.min(remaining, stack.count);
    await bot.toss(stack.type, stack.metadata ?? null, amount);
    dropped += amount;
    remaining -= amount;
  }

  return { dropped, remaining };
}

async function waitForEntityEnd(bot, entityId, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const entity = bot.entities[entityId];
    if (!entity || entity.isValid === false || (typeof entity.health === 'number' && entity.health <= 0)) return 'dead_or_gone';
    await new Promise(r => setTimeout(r, 250));
  }
  return 'timeout';
}

async function runTool(bot, name, args) {
  switch (name) {
    case 'get_state':
      return { username: bot.username, position: pos(bot.entity.position), health: bot.health, food: bot.food, saturation: bot.foodSaturation, dimension: bot.game?.dimension, time: bot.time?.timeOfDay, raining: bot.isRaining };

    case 'get_inventory':
      return bot.inventory.items().map(itemSummary);

    case 'get_nearby_entities': {
      const radius = Math.max(1, Number(args.radius ?? 16));
      return Object.values(bot.entities)
        .filter(e => e !== bot.entity && e.position && bot.entity.position.distanceTo(e.position) <= radius)
        .map(e => ({ id: e.id, type: e.type, name: e.username || e.name || e.displayName || e.mobType, position: pos(e.position), distance: Number(bot.entity.position.distanceTo(e.position).toFixed(2)), health: e.health ?? null }));
    }

    case 'find_blocks': {
      const name = String(args.block).toLowerCase();
      const block = bot.registry.blocksByName[name];
      if (!block) throw new Error(`Unknown block name: ${args.block}`);
      return bot.findBlocks({ matching: block.id, maxDistance: Number(args.maxDistance ?? 32), count: Number(args.count ?? 8) }).map(pos);
    }

    case 'move_to':
      await moveTo(bot, new Vec3(Number(args.x), Number(args.y), Number(args.z)), Number(args.radius ?? 1));
      return { reached: true, position: pos(bot.entity.position) };

    case 'follow_player': {
      bot.pvp?.stop?.();
      const username = String(args.username);
      const player = bot.players[username];
      if (!player?.entity) throw new Error(`Player ${username} is not nearby/loaded`);
      bot.pathfinder.setGoal(new goals.GoalFollow(player.entity, Number(args.distance ?? 2)), true);
      return { following: username, entityId: player.entity.id };
    }

    case 'follow_entity': {
      bot.pvp?.stop?.();
      const entity = bot.entities[Number(args.entityId)];
      if (!entity?.position) throw new Error(`Entity ${args.entityId} is not currently loaded`);
      bot.pathfinder.setGoal(new goals.GoalFollow(entity, Number(args.distance ?? 2)), true);
      return { followingEntity: { id: entity.id, name: entity.name || entity.username || entity.mobType || entity.type } };
    }

    case 'stop':
      bot.pvp?.stop?.();
      bot.pathfinder.setGoal(null);
      bot.clearControlStates();
      return { stopped: true };

    case 'look_at':
      await bot.lookAt(new Vec3(Number(args.x), Number(args.y), Number(args.z)), true);
      return { lookingAt: { x: args.x, y: args.y, z: args.z } };

    case 'equip': {
      const item = findItem(bot, args.item);
      if (!item) throw new Error(`Item not found: ${args.item}`);
      await bot.equip(item, args.destination);
      return { equipped: itemSummary(item), destination: args.destination };
    }

    case 'unequip':
      await bot.unequip(args.destination);
      return { unequipped: args.destination };

    case 'dig': {
      const block = bot.blockAt(new Vec3(Number(args.x), Number(args.y), Number(args.z)));
      if (!block || block.name === 'air') throw new Error('No diggable block at that position');
      await bot.dig(block);
      return { dug: block.name, position: pos(block.position) };
    }

    case 'place_block': {
      const reference = bot.blockAt(new Vec3(Number(args.x), Number(args.y), Number(args.z)));
      if (!reference) throw new Error('Reference block not loaded');
      if (!bot.heldItem) throw new Error('Nothing is held');
      await bot.placeBlock(reference, new Vec3(Number(args.dx ?? 0), Number(args.dy ?? 1), Number(args.dz ?? 0)));
      return { placed: bot.heldItem?.name || 'item' };
    }

    case 'craft': {
      const item = bot.registry.itemsByName[String(args.item).toLowerCase()];
      if (!item) throw new Error(`Unknown item: ${args.item}`);
      const recipes = bot.recipesFor(item.id, null, 1, null);
      if (!recipes.length) throw new Error(`No available recipe for ${args.item}`);
      const count = Math.max(1, Math.floor(Number(args.count ?? 1)));
      await bot.craft(recipes[0], count, null);
      return { crafted: args.item, count };
    }

    case 'smelt': {
      const furnaceBlock = bot.findBlock({ matching: b => b.name === 'furnace' || b.name === 'blast_furnace', maxDistance: 16 });
      if (!furnaceBlock) throw new Error('No furnace/blast furnace found nearby');
      const input = findItem(bot, args.input);
      if (!input) throw new Error(`Input not found: ${args.input}`);
      const furnace = await bot.openFurnace(furnaceBlock);
      try {
        const amount = Math.min(input.count, Math.max(1, Math.floor(Number(args.count ?? 1))));
        await furnace.putInput(input.type, null, amount);
        return { furnace: 'input inserted', input: args.input, count: amount };
      } finally {
        furnace.close();
      }
    }

    case 'eat': {
      const item = findItem(bot, args.item);
      if (!item) throw new Error(`Food not found: ${args.item}`);
      await bot.equip(item, 'hand');
      await bot.consume();
      return { ate: args.item };
    }

    case 'attack_entity': {
      if (!bot.pvp) throw new Error('Mineflayer-PVP plugin is not loaded');
      const entityId = Number(args.entityId);
      const entity = bot.entities[entityId];
      if (!entity?.position) throw new Error(`Entity ${entityId} is not currently loaded`);
      const timeoutMs = Math.min(120000, Math.max(1000, Number(args.timeoutSeconds ?? 30) * 1000));
      bot.pathfinder.setGoal(null);
      bot.pvp.attack(entity);
      const result = await waitForEntityEnd(bot, entityId, timeoutMs);
      bot.pvp.stop();
      return { target: { id: entity.id, name: entity.name || entity.username || entity.mobType || entity.type }, result };
    }

    case 'give_items_to_player': {
      const username = String(args.username);
      const player = bot.players[username];
      if (!player?.entity) throw new Error(`Player ${username} is not nearby/loaded`);
      const itemName = String(args.item).toLowerCase();
      const count = Math.max(1, Math.floor(Number(args.count ?? 1)));
      await moveTo(bot, player.entity.position, 2);
      const before = findItems(bot, itemName).reduce((n, i) => n + i.count, 0);
      const result = await dropMatchingItems(bot, itemName, count);
      const after = findItems(bot, itemName).reduce((n, i) => n + i.count, 0);
      return { player: username, item: itemName, requested: count, dropped: result.dropped, remainingToDrop: result.remaining, inventoryBefore: before, inventoryAfter: after };
    }

    case 'collect_and_deliver': {
      const username = String(args.username);
      const player = bot.players[username];
      if (!player?.entity) throw new Error(`Player ${username} is not nearby/loaded`);
      const blockName = String(args.block).toLowerCase();
      const blockType = bot.registry.blocksByName[blockName];
      if (!blockType) throw new Error(`Unknown block name: ${args.block}`);
      const requested = Math.max(1, Math.floor(Number(args.count ?? 1)));
      const searchDistance = Math.max(8, Number(args.searchDistance ?? 48));
      let collected = 0;
      const before = findItems(bot, blockName).reduce((n, i) => n + i.count, 0);

      for (let i = 0; i < requested * 3 && collected < requested; i++) {
        const positions = bot.findBlocks({ matching: blockType.id, maxDistance: searchDistance, count: 1 });
        if (!positions.length) break;
        await moveTo(bot, positions[0], 1);
        const block = bot.blockAt(positions[0]);
        if (!block || block.name !== blockName) continue;
        await bot.dig(block);
        const now = findItems(bot, blockName).reduce((n, item) => n + item.count, 0);
        collected = Math.max(0, now - before);
      }

      const refreshedPlayer = bot.players[username];
      if (!refreshedPlayer?.entity) throw new Error(`Player ${username} is no longer loaded/visible`);
      await moveTo(bot, refreshedPlayer.entity.position, 2);
      const drop = await dropMatchingItems(bot, blockName, Math.min(requested, collected));
      return { player: username, block: blockName, requested, collected, dropped: drop.dropped, remainingToDrop: drop.remaining };
    }

    case 'chat':
      bot.chat(String(args.message));
      return { sent: String(args.message) };

    case 'wait': {
      const ms = Math.min(10000, Math.max(0, Number(args.milliseconds ?? 1000)));
      await new Promise(r => setTimeout(r, ms));
      return { waitedMs: ms };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

module.exports = { toolDefinitions, runTool };
