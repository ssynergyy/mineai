const FOOD_NAMES = new Set([
  'apple','golden_apple','enchanted_golden_apple','bread','carrot','golden_carrot','potato','baked_potato','poisonous_potato','beetroot','beetroot_soup','mushroom_stew','rabbit_stew','suspicious_stew','dried_kelp','melon_slice','sweet_berries','glow_berries','chorus_fruit',
  'cooked_beef','cooked_porkchop','cooked_mutton','cooked_chicken','cooked_rabbit','cooked_cod','cooked_salmon','pufferfish','tropical_fish','cod','salmon','beef','porkchop','mutton','chicken','rabbit','rotten_flesh','spider_eye','honey_bottle','cookie','pumpkin_pie','cake'
]);

function isFood(item) { return FOOD_NAMES.has(item?.name); }
function findFood(bot) { return bot.inventory.items().find(isFood); }

class Automation {
  constructor(bot, config) {
    this.bot = bot;
    this.config = config;
    this.busyEat = false;
    this.busyArmor = false;
    this.noFoodAnnounced = false;
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
    if (this.busyArmor || !this.config.automation.autoEquipArmor || !this.bot.entity) return;
    this.busyArmor = true;
    try {
      for (const destination of ['head','torso','legs','feet']) {
        const slot = this.bot.getEquipmentDestSlot(destination);
        const equipped = this.bot.inventory.slots[slot];
        const currentRank = this.armorRank(equipped);
        const candidates = this.bot.inventory.items()
          .filter(i => this.armorDestination(i.name) === destination)
          .sort((a, b) => this.armorRank(b) - this.armorRank(a));
        if (candidates[0] && this.armorRank(candidates[0]) > currentRank) await this.bot.equip(candidates[0], destination);
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
    if (!needsFood) {
      this.noFoodAnnounced = false;
      return;
    }
    const food = findFood(this.bot);
    if (!food) {
      if (!this.noFoodAnnounced) {
        this.noFoodAnnounced = true;
        this.bot.chat('I have no food left.');
      }
      return;
    }
    this.noFoodAnnounced = false;
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

  async tick() {
    // Survival automation is deliberately tiny and never creates a user task.
    await this.eatIfNeeded();
    await this.equipBestArmor();
  }
}

module.exports = { Automation, FOOD_NAMES, findFood };
