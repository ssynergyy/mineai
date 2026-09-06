const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');

function pos(p) { return { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) }; }
function itemSummary(item) { return { name: item.name, displayName: item.displayName, count: item.count, type: item.type, metadata: item.metadata }; }
function findItem(bot, name) {
  const target = String(name).toLowerCase();
  return bot.inventory.items().find(i => i.name.toLowerCase() === target || i.displayName.toLowerCase() === target);
}
function itemName(entity) { return entity?.username || entity?.name || entity?.displayName || entity?.displayName || 'unknown'; }
function taskToken(bot, name) { return bot.tasks.start(name); }
function assertCurrent(bot, token) { if (!bot.tasks.isCurrent(token)) throw new Error('Task cancelled'); }

function nearestBlock(bot, names, maxDistance = 24) {
  const wanted = new Set(names);
  return bot.findBlock({ matching: b => wanted.has(b.name), maxDistance });
}

async function moveTo(bot, target, radius, token) {
  bot.pathfinder.setGoal(new goals.GoalNear(target.x, target.y, target.z, radius));
  await new Promise((resolve, reject) => {
    let done = false;
    const finish = err => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(check);
      bot.removeListener('goal_reached', onGoal);
      bot.removeListener('path_update', onPath);
      err ? reject(err) : resolve();
    };
    const onGoal = () => finish();
    const onPath = r => { if (r?.status === 'noPath') finish(new Error('Pathfinder could not reach target')); };
    const timer = setTimeout(() => finish(new Error('Pathfinding timed out after 60 seconds')), 60000);
    const check = setInterval(() => {
      if (!bot.tasks.isCurrent(token)) finish(new Error('Task cancelled'));
    }, 100);
    bot.once('goal_reached', onGoal);
    bot.on('path_update', onPath);
  });
}

async function craftAuto(bot, itemNameWanted, count) {
  const item = bot.registry.itemsByName[itemNameWanted];
  if (!item) throw new Error(`Unknown item: ${itemNameWanted}`);
  const desired = Math.max(1, Number(count || 1));
  let recipes = bot.recipesFor(item.id, null, desired, null);
  let table = null;
  if (!recipes.length) {
    table = nearestBlock(bot, ['crafting_table'], 24);
    if (!table) throw new Error(`No recipe available for ${itemNameWanted}, and no crafting table is nearby`);
    recipes = bot.recipesFor(item.id, null, desired, table);
  }
  if (!recipes.length) throw new Error(`No usable recipe for ${itemNameWanted}`);
  if (table) {
    const token = taskToken(bot, 'craft');
    await moveTo(bot, table.position, 3, token);
    assertCurrent(bot, token);
    await bot.craft(recipes[0], desired, table);
  } else {
    await bot.craft(recipes[0], desired, null);
  }
  return { crafted: itemNameWanted, count: desired, usedCraftingTable: Boolean(table) };
}

function findFuel(bot) {
  const fuelNames = ['coal','charcoal','coal_block','wood','oak_log','birch_log','spruce_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log','bamboo','sticks','oak_planks','birch_planks','spruce_planks','jungle_planks','acacia_planks','dark_oak_planks','mangrove_planks','cherry_planks'];
  for (const name of fuelNames) {
    const item = findItem(bot, name);
    if (item) return item;
  }
  return null;
}

async function useFurnace(bot, station, inputName, count, fuelName) {
  const stationMap = {
    furnace: ['furnace', 'lit_furnace'],
    smoker: ['smoker', 'lit_smoker'],
    blast_furnace: ['blast_furnace', 'lit_blast_furnace']
  };
  const names = stationMap[station];
  if (!names) throw new Error(`Unknown station: ${station}`);
  const block = nearestBlock(bot, names, 32);
  if (!block) throw new Error(`No ${station} found nearby`);
  const input = findItem(bot, inputName);
  if (!input) throw new Error(`Input not found: ${inputName}`);
  const fuel = fuelName ? findItem(bot, fuelName) : findFuel(bot);
  if (!fuel) throw new Error('No furnace fuel found in inventory');
  const token = taskToken(bot, `use_${station}`);
  await moveTo(bot, block.position, 3, token);
  assertCurrent(bot, token);
  const furnace = await bot.openFurnace(block);
  try {
    const amount = Math.max(1, Math.min(input.count, Number(count || 1)));
    const fuelAmount = Math.min(fuel.count, Math.max(1, Math.ceil(amount / 8)));
    await furnace.putInput(input.type, input.metadata ?? null, amount);
    if (!furnace.fuelItem() || furnace.fuel <= 0.01) {
      await furnace.putFuel(fuel.type, fuel.metadata ?? null, fuelAmount);
    }
    return {
      station,
      input: input.name,
      count: amount,
      fuel: fuel.name,
      output: furnace.outputItem()?.name || null
    };
  } finally {
    furnace.close();
  }
}

function parseChoice(choice) {
  if (typeof choice === 'number') return choice;
  const n = String(choice ?? '').trim().toLowerCase();
  if (/^[0-2]$/.test(n)) return Number(n);
  return null;
}

function findInventoryItemMatching(bot, query) {
  const target = String(query || '').toLowerCase();
  return bot.inventory.items().find(i => i.name.toLowerCase() === target || i.displayName.toLowerCase() === target || i.name.toLowerCase().includes(target));
}

async function openTarget(bot, blockName, openFn, maxDistance = 24) {
  const block = nearestBlock(bot, [blockName], maxDistance);
  if (!block) throw new Error(`No ${blockName} nearby`);
  const token = taskToken(bot, `use_${blockName}`);
  await moveTo(bot, block.position, 3, token);
  assertCurrent(bot, token);
  return { block, window: await openFn(block) };
}

function toolDefinitions() {
  const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
  const fn = (name, description, parameters) => ({ type: 'function', function: { name, description, parameters } });
  return [
    fn('get_state', 'Get current bot state.', obj()),
    fn('get_inventory', 'List non-empty inventory slots.', obj()),
    fn('get_nearby_entities', 'List nearby players and mobs.', obj({ radius: { type: 'number', default: 20 } })),
    fn('find_blocks', 'Find nearby blocks by exact Minecraft block name.', obj({ block: { type: 'string' }, maxDistance: { type: 'number', default: 32 }, count: { type: 'number', default: 8 } }, ['block'])),
    fn('move_to', 'Navigate to a coordinate.', obj({ x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' }, radius: { type: 'number', default: 1 } }, ['x','y','z'])),
    fn('follow_player', 'Continuously follow a player.', obj({ username: { type: 'string' }, distance: { type: 'number', default: 2 } }, ['username'])),
    fn('follow_entity', 'Continuously follow a live entity by id.', obj({ entityId: { type: 'number' }, distance: { type: 'number', default: 2 } }, ['entityId'])),
    fn('patrol', 'Patrol through any number of supplied coordinates; loops=0 repeats forever.', obj({ points: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } }, required: ['x','y','z'], additionalProperties: false } }, radius: { type: 'number', default: 1 }, loops: { type: 'number', default: 0 } }, ['points'])),
    fn('stop', 'Stop movement, combat, and current AI task.', obj()),
    fn('look_at', 'Look at a coordinate.', obj({ x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } }, ['x','y','z'])),
    fn('equip', 'Equip an inventory item to hand/head/torso/legs/feet.', obj({ item: { type: 'string' }, destination: { type: 'string', enum: ['hand','head','torso','legs','feet'] } }, ['item','destination'])),
    fn('unequip', 'Unequip an equipment slot.', obj({ destination: { type: 'string', enum: ['hand','head','torso','legs','feet'] } }, ['destination'])),
    fn('dig', 'Dig a block at coordinates.', obj({ x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } }, ['x','y','z'])),
    fn('place_block', 'Place the held block against a reference block face.', obj({ x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' }, dx: { type: 'number', default: 0 }, dy: { type: 'number', default: 1 }, dz: { type: 'number', default: 0 } }, ['x','y','z'])),
    fn('craft', 'Craft an item. Automatically finds and uses a nearby crafting table when needed.', obj({ item: { type: 'string' }, count: { type: 'number', default: 1 } }, ['item'])),
    fn('use_furnace', 'Smelt/smoke/blast-smelt an item. Automatically finds the requested station and fuel.', obj({ station: { type: 'string', enum: ['furnace','smoker','blast_furnace'] }, input: { type: 'string' }, count: { type: 'number', default: 1 }, fuel: { type: 'string' } }, ['station','input'])),
    fn('take_furnace_output', 'Take the current output from a nearby furnace/smoker/blast furnace.', obj({ station: { type: 'string', enum: ['furnace','smoker','blast_furnace'] } }, ['station'])),
    fn('eat', 'Eat food from inventory.', obj({ item: { type: 'string' } }, ['item'])),
    fn('attack_entity', 'Continuously attack and chase a live entity.', obj({ entityId: { type: 'number' } }, ['entityId'])),
    fn('give_items_to_player', 'Return to a player and drop matching inventory items at them.', obj({ player: { type: 'string' }, item: { type: 'string' }, count: { type: 'number', default: 0 } }, ['player','item'])),
    fn('drop_on_hopper', 'Move to a hopper and drop matching items so the hopper can collect them. count=0 means all.', obj({ item: { type: 'string' }, count: { type: 'number', default: 0 }, x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } }, ['item'])),
    fn('enchant', 'Use a nearby enchantment table. choice may be 0,1,2 or a substring of the desired enchantment name.', obj({ item: { type: 'string' }, choice: { type: 'string' } }, ['item','choice'])),
    fn('anvil', 'Use a nearby anvil to rename an item or combine two items.', obj({ action: { type: 'string', enum: ['rename','combine'] }, item: { type: 'string' }, secondItem: { type: 'string' }, name: { type: 'string' } }, ['action','item'])),
    fn('trade_villager', 'Inspect and execute a villager trade by index.', obj({ entityId: { type: 'number' }, tradeIndex: { type: 'number' }, times: { type: 'number', default: 1 } }, ['entityId','tradeIndex'])),
    fn('list_villager_trades', 'Inspect the trades of a nearby villager.', obj({ entityId: { type: 'number' } }, ['entityId'])),
    fn('chat', 'Send public Minecraft chat.', obj({ message: { type: 'string' } }, ['message'])),
    fn('whisper', 'Whisper a player.', obj({ player: { type: 'string' }, message: { type: 'string' } }, ['player','message'])),
    fn('manage_player_list', 'Manage friendly/hostile/protected player lists. Protected is runtime-only and must not use .env.', obj({ action: { type: 'string', enum: ['list','add_friendly','remove_friendly','add_hostile','remove_hostile','add_protected','remove_protected'] }, player: { type: 'string' } }, ['action'])),
    fn('wait', 'Wait briefly.', obj({ milliseconds: { type: 'number', default: 1000 } }))
  ];
}

async function runTool(bot, name, args) {
  switch (name) {
    case 'get_state':
      return { username: bot.username, position: pos(bot.entity.position), health: bot.health, maxHealth: bot.maxHealth, food: bot.food, saturation: bot.foodSaturation, dimension: bot.game?.dimension, time: bot.time?.timeOfDay, raining: bot.isRaining, protected: bot.security?.lists().protected || [] };
    case 'get_inventory': return bot.inventory.items().map(itemSummary);
    case 'get_nearby_entities': {
      const r = Math.max(1, Number(args.radius ?? 20));
      return Object.values(bot.entities).filter(e => e !== bot.entity && e.position && bot.entity.position.distanceTo(e.position) <= r).map(e => ({ id: e.id, type: e.type, name: itemName(e), position: pos(e.position), distance: Number(bot.entity.position.distanceTo(e.position).toFixed(2)), health: e.health ?? null }));
    }
    case 'find_blocks': {
      const block = bot.registry.blocksByName[String(args.block)];
      if (!block) throw new Error(`Unknown block: ${args.block}`);
      return bot.findBlocks({ matching: block.id, maxDistance: Number(args.maxDistance ?? 32), count: Number(args.count ?? 8) }).map(pos);
    }
    case 'move_to': {
      const token = taskToken(bot, 'move_to');
      await moveTo(bot, new Vec3(Number(args.x), Number(args.y), Number(args.z)), Number(args.radius ?? 1), token);
      assertCurrent(bot, token);
      return { reached: true, position: pos(bot.entity.position) };
    }
    case 'follow_player': {
      const p = bot.players[String(args.username)] || Object.values(bot.players).find(x => x?.username?.toLowerCase() === String(args.username).toLowerCase());
      if (!p?.entity) throw new Error(`Player ${args.username} not loaded`);
      taskToken(bot, 'follow_player');
      bot.pathfinder.setGoal(new goals.GoalFollow(p.entity, Number(args.distance ?? 2)), true);
      return { following: p.username };
    }
    case 'follow_entity': {
      const e = bot.entities[Number(args.entityId)];
      if (!e?.position) throw new Error(`Entity ${args.entityId} not found`);
      taskToken(bot, 'follow_entity');
      bot.pathfinder.setGoal(new goals.GoalFollow(e, Number(args.distance ?? 2)), true);
      return { following: { id: e.id, name: itemName(e) } };
    }
    case 'patrol': {
      if (!Array.isArray(args.points) || !args.points.length) throw new Error('Patrol needs at least one point');
      const token = taskToken(bot, 'patrol');
      const loops = Math.max(0, Number(args.loops ?? 0));
      let loop = 0;
      while (loops === 0 || loop < loops) {
        for (const point of args.points) {
          assertCurrent(bot, token);
          await moveTo(bot, new Vec3(Number(point.x), Number(point.y), Number(point.z)), Number(args.radius ?? 1), token);
        }
        loop++;
      }
      return { patrolComplete: true, loopsCompleted: loop };
    }
    case 'stop':
      bot.tasks.cancel(); try { bot.pvp.stop(); } catch {}
      try { bot.pathfinder.setGoal(null); } catch {}
      bot.clearControlStates();
      return { stopped: true };
    case 'look_at': {
      const target = new Vec3(Number(args.x), Number(args.y), Number(args.z));
      await bot.lookAt(target, true); return { lookingAt: pos(target) };
    }
    case 'equip': {
      const item = findItem(bot, args.item); if (!item) throw new Error(`Item not found: ${args.item}`);
      await bot.equip(item, args.destination); return { equipped: itemSummary(item) };
    }
    case 'unequip': await bot.unequip(args.destination); return { unequipped: args.destination };
    case 'dig': {
      const b = bot.blockAt(new Vec3(Number(args.x), Number(args.y), Number(args.z)));
      if (!b || b.name === 'air') throw new Error('No diggable block there');
      await bot.dig(b); return { dug: b.name, position: pos(b.position) };
    }
    case 'place_block': {
      const ref = bot.blockAt(new Vec3(Number(args.x), Number(args.y), Number(args.z)));
      if (!ref) throw new Error('Reference block not loaded');
      const held = bot.heldItem; if (!held) throw new Error('Nothing is held');
      await bot.placeBlock(ref, new Vec3(Number(args.dx ?? 0), Number(args.dy ?? 1), Number(args.dz ?? 0)));
      return { placed: held.name };
    }
    case 'craft': return await craftAuto(bot, String(args.item), Number(args.count ?? 1));
    case 'use_furnace': return await useFurnace(bot, String(args.station), String(args.input), Number(args.count ?? 1), args.fuel ? String(args.fuel) : null);
    case 'take_furnace_output': {
      const station = String(args.station);
      const map = { furnace: ['furnace','lit_furnace'], smoker: ['smoker','lit_smoker'], blast_furnace: ['blast_furnace','lit_blast_furnace'] };
      const block = nearestBlock(bot, map[station] || [], 32); if (!block) throw new Error(`No ${station} found nearby`);
      const token = taskToken(bot, `take_${station}`); await moveTo(bot, block.position, 3, token); assertCurrent(bot, token);
      const furnace = await bot.openFurnace(block); try { const out = furnace.outputItem(); if (!out) return { output: null }; const item = await furnace.takeOutput(); return { taken: itemSummary(item) }; } finally { furnace.close(); }
    }
    case 'eat': {
      const item = findItem(bot, args.item); if (!item) throw new Error(`Food not found: ${args.item}`);
      await bot.equip(item, 'hand'); await bot.consume(); return { ate: args.item };
    }
    case 'attack_entity': {
      const e = bot.entities[Number(args.entityId)]; if (!e?.position) throw new Error(`Entity ${args.entityId} not found`);
      taskToken(bot, 'combat');
      if (e.type === 'player' && bot.security?.isElite(e.username)) throw new Error('Refusing to intentionally attack a player whose name contains EliteSynergy');
      if (bot.security) await bot.security.equipBestWeapon();
      bot.pvp.attack(e);
      return { attacking: { id: e.id, name: itemName(e) } };
    }
    case 'give_items_to_player': {
      const p = bot.players[String(args.player)] || Object.values(bot.players).find(x => x?.username?.toLowerCase() === String(args.player).toLowerCase());
      if (!p?.entity) throw new Error(`Player ${args.player} not loaded`);
      const token = taskToken(bot, 'delivery');
      const target = String(args.item).toLowerCase(); let remaining = Math.max(0, Number(args.count ?? 0));
      const items = bot.inventory.items().filter(i => i.name.toLowerCase() === target || i.displayName.toLowerCase() === target);
      if (!items.length) throw new Error(`No ${args.item} in inventory`);
      await moveTo(bot, p.entity.position, 2, token); assertCurrent(bot, token);
      let dropped = 0;
      for (const item of [...items]) {
        if (remaining && dropped >= remaining) break;
        const n = remaining ? Math.min(item.count, remaining - dropped) : item.count;
        await bot.toss(item.type, item.metadata ?? null, n); dropped += n;
      }
      return { deliveredItem: args.item, count: dropped, player: p.username };
    }
    case 'drop_on_hopper': {
      const token = taskToken(bot, 'hopper_drop');
      let hopper = null;
      if (args.x !== undefined && args.y !== undefined && args.z !== undefined) {
        hopper = bot.blockAt(new Vec3(Number(args.x), Number(args.y), Number(args.z)));
        if (hopper?.name !== 'hopper') throw new Error('Supplied coordinates are not a hopper');
      } else {
        hopper = nearestBlock(bot, ['hopper'], 32);
      }
      if (!hopper) throw new Error('No hopper found nearby');
      const target = String(args.item).toLowerCase(); let remaining = Math.max(0, Number(args.count ?? 0));
      const items = bot.inventory.items().filter(i => i.name.toLowerCase() === target || i.displayName.toLowerCase() === target);
      if (!items.length) throw new Error(`No ${args.item} in inventory`);
      await moveTo(bot, hopper.position, 2, token); assertCurrent(bot, token);
      let dropped = 0;
      for (const item of [...items]) {
        if (remaining && dropped >= remaining) break;
        const n = remaining ? Math.min(item.count, remaining - dropped) : item.count;
        await bot.toss(item.type, item.metadata ?? null, n);
        dropped += n;
      }
      return { droppedOnHopper: hopper.position, item: args.item, count: dropped };
    }
    case 'enchant': {
      const item = findInventoryItemMatching(bot, args.item); if (!item) throw new Error(`Item not found: ${args.item}`);
      const { window } = await openTarget(bot, 'enchanting_table', b => bot.openEnchantmentTable(b));
      try {
        await window.putTargetItem(item);
        const lapis = findItem(bot, 'lapis_lazuli');
        if (lapis) await window.putLapis(lapis);
        await new Promise(resolve => {
          if (window.enchantments?.length) return resolve();
          const timer = setTimeout(resolve, 3000);
          window.once('ready', () => { clearTimeout(timer); resolve(); });
        });
        let choice = parseChoice(args.choice);
        if (choice === null) {
          const needle = String(args.choice).toLowerCase();
          choice = window.enchantments.findIndex(e => {
            const data = bot.registry.enchantments?.[e?.expected?.enchant] || null;
            return Boolean(data && (String(data.name).toLowerCase().includes(needle) || String(data.displayName).toLowerCase().includes(needle)));
          });
          if (choice < 0) choice = 0;
        }
        if (!window.enchantments?.[choice] || window.enchantments[choice].level < 0) throw new Error('No usable enchantment choice is available');
        const result = await window.enchant(choice);
        return { enchanted: item.name, choice, result: result?.name || null, enchantment: window.enchantments[choice] };
      } finally { window.close(); }
    }
    case 'anvil': {
      const main = findInventoryItemMatching(bot, args.item); if (!main) throw new Error(`Item not found: ${args.item}`);
      const { window } = await openTarget(bot, 'anvil', b => bot.openAnvil(b));
      try {
        if (args.action === 'rename') {
          if (!args.name) throw new Error('Rename requires a name');
          await window.rename(main, String(args.name));
          return { renamed: main.name, name: String(args.name) };
        }
        if (args.action === 'combine') {
          const second = findInventoryItemMatching(bot, args.secondItem);
          if (!second) throw new Error(`Second item not found: ${args.secondItem}`);
          await window.combine(main, second, args.name ? String(args.name) : undefined);
          return { combined: [main.name, second.name], name: args.name || null };
        }
        throw new Error(`Unknown anvil action: ${args.action}`);
      } finally { window.close(); }
    }
    case 'list_villager_trades': {
      const entity = bot.entities[Number(args.entityId)];
      if (!entity || entity.type !== 'mob' || !String(entity.displayName || entity.name || '').toLowerCase().includes('villager')) throw new Error('Villager entity not found');
      const token = taskToken(bot, 'villager_inspect'); await moveTo(bot, entity.position, 3, token); assertCurrent(bot, token);
      const villager = await bot.openVillager(entity);
      try {
        return villager.trades.map((t, i) => ({ index: i, disabled: !!t.tradeDisabled, input1: itemSummary(t.inputItem1), input2: t.inputItem2 ? itemSummary(t.inputItem2) : null, output: itemSummary(t.outputItem), uses: t.nbTradeUses, maxUses: t.maximumNbTradeUses }));
      } finally { villager.close(); }
    }
    case 'trade_villager': {
      const entity = bot.entities[Number(args.entityId)];
      if (!entity) throw new Error(`Entity ${args.entityId} not found`);
      const token = taskToken(bot, 'villager_trade'); await moveTo(bot, entity.position, 3, token); assertCurrent(bot, token);
      const villager = await bot.openVillager(entity);
      try {
        const idx = Number(args.tradeIndex);
        if (!villager.trades[idx]) throw new Error(`Trade ${idx} does not exist`);
        if (villager.trades[idx].tradeDisabled) throw new Error(`Trade ${idx} is disabled`);
        const times = Math.max(1, Number(args.times ?? 1));
        await bot.trade(villager, idx, times);
        return { traded: true, tradeIndex: idx, times };
      } finally { villager.close(); }
    }
    case 'chat': bot.chat(String(args.message)); return { sent: String(args.message) };
    case 'whisper': bot.whisper(String(args.player), String(args.message)); return { whispered: String(args.player) };
    case 'manage_player_list': {
      const s = bot.security; if (!s) throw new Error('Security system not initialized');
      if (args.action === 'list') return s.lists();
      const map = { add_friendly:['friendly','add'], remove_friendly:['friendly','remove'], add_hostile:['hostile','add'], remove_hostile:['hostile','remove'], add_protected:['protected','add'], remove_protected:['protected','remove'] };
      const [list, op] = map[args.action] || []; if (!list) throw new Error('Unknown list action');
      if (!args.player) throw new Error('Player is required for this action');
      return s[op](list, args.player);
    }
    case 'wait': { const ms = Math.min(10000, Math.max(0, Number(args.milliseconds ?? 1000))); await new Promise(r => setTimeout(r, ms)); return { waitedMs: ms }; }
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

module.exports = { toolDefinitions, runTool };
