const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

const FOOD_NAMES = new Set([
  'apple','golden_apple','enchanted_golden_apple','bread','carrot','golden_carrot','potato','baked_potato','poisonous_potato','beetroot','beetroot_soup','mushroom_stew','rabbit_stew','suspicious_stew','dried_kelp','melon_slice','sweet_berries','glow_berries','chorus_fruit',
  'cooked_beef','cooked_porkchop','cooked_mutton','cooked_chicken','cooked_rabbit','cooked_cod','cooked_salmon','pufferfish','tropical_fish','cod','salmon','beef','porkchop','mutton','chicken','rabbit','rotten_flesh','spider_eye','honey_bottle','cookie','pumpkin_pie','cake'
]);

const ANIMALS = new Set(['cow','pig','sheep','chicken','rabbit']);

function isFood(item) { return FOOD_NAMES.has(item?.name); }
function findFood(bot) { return bot.inventory.items().find(isFood); }

class Automation {
  constructor(bot, config) {
    this.bot = bot;
    this.config = config;
    this.busyEat = false;
    this.busyArmor = false;
    this.busyHunt = false;
    this.huntPrompted = false;
    this.bot.huntApproval = !config.automation.askBeforeAutoHunt;
  }

  armorRank(item) {
    if (!item?.name) return -1;
    const n = item.name.toLowerCase();
    if (!/(helmet|chestplate|leggings|boots)/.test(n)) return -1;
    if (n.includes('netherite')) return 5;
    if (n.includes('diamond')) return 4;
    if (n.includes('iron')) return 3;
    if (n.includes('chainmail')) return 2;
    if (n.includes('golden')) return 1;
    if (n.includes('leather')) return 0;
    return -1;
  }

  armorDestination(name) {
    if (/helmet$/.test(name)) return 'head';
    if (/chestplate$/.test(name)) return 'torso';
    if (/leggings$/.test(name)) return 'legs';
    if (/boots$/.test(name)) return 'feet';
    return null;
  }

  async equipBestArmor() {
    if (this.busyArmor || !this.bot.entity) return;
    this.busyArmor = true;
    try {
      for (const destination of ['head','torso','legs','feet']) {
        const slot = this.bot.getEquipmentDestSlot(destination);
        const equipped = this.bot.inventory.slots[slot];
        const currentRank = this.armorRank(equipped);
        const candidates = this.bot.inventory.items().filter(i => this.armorDestination(i.name) === destination).sort((a,b)=>this.armorRank(b)-this.armorRank(a));
        if (candidates[0] && this.armorRank(candidates[0]) > currentRank) {
          await this.bot.equip(candidates[0], destination);
        }
      }
    } catch (err) {
      console.log(`[automation] armor: ${err.message}`);
    } finally {
      this.busyArmor = false;
    }
  }

  async eatIfNeeded() {
    if (this.busyEat || !this.config.automation.autoEat || !this.bot.entity) return;
    const needsFood = this.bot.food < 10 || (this.bot.health < this.bot.maxHealth && this.bot.food < 20);
    if (!needsFood) return;
    const food = findFood(this.bot);
    if (!food) return;
    this.busyEat = true;
    try {
      await this.bot.equip(food, 'hand');
      await this.bot.consume();
    } catch (err) {
      console.log(`[automation] eat: ${err.message}`);
    } finally {
      this.busyEat = false;
    }
  }

  nearestAnimal() {
    return Object.values(this.bot.entities)
      .filter(e => e !== this.bot.entity && e.position && ANIMALS.has(String(e.mobType || e.name || '').toLowerCase()))
      .sort((a,b)=>this.bot.entity.position.distanceTo(a.position)-this.bot.entity.position.distanceTo(b.position))[0] || null;
  }

  async autoHunt() {
    if (this.busyHunt || !this.config.automation.autoHunt || !this.bot.entity) return;
    if (findFood(this.bot)) { this.huntPrompted = false; return; }
    if (!this.config.automation.askBeforeAutoHunt) this.bot.huntApproval = true;
    if (!this.bot.huntApproval) {
      if (!this.huntPrompted) {
        this.huntPrompted = true;
        this.bot.whisper(this.config.security.owner, 'I have no food. Auto-hunt animals? Reply "yes hunt" or "no hunt".');
      }
      return;
    }
    this.busyHunt = true;
    try {
      const target = this.nearestAnimal();
      if (!target || this.bot.entity.position.distanceTo(target.position) > this.config.automation.autoHuntRange) return;
      const weapon = this.bestWeapon();
      if (weapon) { try { await this.bot.equip(weapon, 'hand'); } catch {} }
      this.bot.pvp.attack(target);
      const start = Date.now();
      while (Date.now() - start < 15000) {
        if (!target.isValid || target.health === undefined || target.health <= 0) break;
        await this.bot.waitForTicks(5);
      }
      const dropPos = target.position?.clone?.() || new Vec3(target.position.x,target.position.y,target.position.z);
      if (dropPos) {
        try {
          this.bot.pathfinder.setGoal(new goals.GoalNear(dropPos.x,dropPos.y,dropPos.z,1));
          await this.bot.waitForTicks(20);
        } catch {}
      }
    } catch (err) {
      console.log(`[automation] hunt: ${err.message}`);
    } finally {
      try { this.bot.pvp.stop(); } catch {}
      this.busyHunt = false;
    }
  }

  bestWeapon() {
    const score = item => {
      const n = item?.name || '';
      if (/netherite_sword/.test(n)) return 500;
      if (/diamond_sword/.test(n)) return 400;
      if (/iron_sword/.test(n)) return 300;
      if (/stone_sword/.test(n)) return 200;
      if (/wooden_sword|golden_sword/.test(n)) return 100;
      if (/netherite_axe/.test(n)) return 450;
      if (/diamond_axe/.test(n)) return 350;
      if (/iron_axe/.test(n)) return 250;
      return -1;
    };
    return this.bot.inventory.items().sort((a,b)=>score(b)-score(a))[0];
  }

  async tick() {
    await this.eatIfNeeded();
    await this.equipBestArmor();
    await this.autoHunt();
  }
}

module.exports = { Automation, FOOD_NAMES, findFood };
