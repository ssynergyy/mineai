const { goals } = require('mineflayer-pathfinder');

class Security {
  constructor(bot, config) {
    this.bot = bot;
    this.owner = config.security.owner;
    this.friendly = new Set((config.security.friendly || []).map(String));
    this.hostile = new Set((config.security.hostile || []).map(String));
    this.protected = new Set();
    this.pending = new Map();
    this.enabled = config.security.enabled;
    this.currentProtected = null;
  }

  normalize(name) { return String(name || '').toLowerCase(); }
  isElite(name) { return this.normalize(name).includes(this.normalize(this.owner)); }
  samePlayer(a, b) { return this.normalize(a) === this.normalize(b); }
  isFriendly(name) { return [...this.friendly].some(n => this.samePlayer(n, name)) || this.isElite(name); }
  isHostile(name) { return [...this.hostile].some(n => this.samePlayer(n, name)); }
  isProtected(name) { return [...this.protected].some(n => this.samePlayer(n, name)); }

  add(list, name) {
    name = String(name || '').trim();
    if (!name) throw new Error('Player name is required');
    this[list].add(name);
    return { [list]: [...this[list]] };
  }
  remove(list, name) {
    name = String(name || '').trim();
    this[list].delete([...this[list]].find(n => this.samePlayer(n, name)) || name);
    return { [list]: [...this[list]] };
  }
  lists() {
    return {
      owner: this.owner,
      friendly: [...this.friendly],
      hostile: [...this.hostile],
      protected: [...this.protected],
      pendingPermissions: [...this.pending.keys()]
    };
  }

  stopCombat() {
    try { this.bot.pvp?.stop(); } catch {}
    try { this.bot.pathfinder?.setGoal(null); } catch {}
    try { this.bot.clearControlStates(); } catch {}
  }

  weaponScore(item) {
    if (!item?.name) return -1;
    const n = item.name.toLowerCase();
    if (!/(sword|axe|trident|mace)/.test(n)) return -1;
    let base = n.includes('netherite') ? 500 : n.includes('diamond') ? 400 : n.includes('iron') ? 300 : n.includes('stone') ? 200 : n.includes('golden') ? 180 : n.includes('wooden') ? 100 : n.includes('trident') ? 350 : n.includes('mace') ? 450 : 50;
    if (n.includes('sword')) base += 25;
    if (n.includes('axe')) base += 20;
    if (n.includes('mace')) base += 30;
    return base;
  }

  async equipBestWeapon() {
    const item = this.bot.inventory.items().sort((a, b) => this.weaponScore(b) - this.weaponScore(a))[0];
    if (!item || this.weaponScore(item) < 0) return null;
    try { await this.bot.equip(item, 'hand'); return item; } catch { return null; }
  }

  attack(entity, reason = 'self-defense') {
    if (!entity || !entity.position || !this.enabled) return false;
    const name = entity.username || entity.name || entity.displayName || entity.displayName || 'unknown';
    if (entity.type === 'player' && this.isElite(name)) return false;
    void this.equipBestWeapon();
    this.bot.pvp.attack(entity);
    console.log(`[security] attacking ${name} (${reason})`);
    return true;
  }

  askPermission(player) {
    if (!player || this.isElite(player) || this.isFriendly(player)) return;
    if (this.pending.has(player)) return;
    const expires = Date.now() + 30000;
    this.pending.set(player, expires);
    this.bot.whisper(this.owner, `Hostile player ${player} detected. Attack? Reply "yes ${player}" or "no ${player}" within 30s.`);
    setTimeout(() => {
      if (this.pending.get(player) === expires) this.pending.delete(player);
    }, 31000);
  }

  permissionMessage(username, message) {
    if (!this.isElite(username)) return false;
    const text = String(message).trim();
    const m = text.match(/^(yes|no)\s+(.+)$/i);
    if (!m) return false;
    const decision = m[1].toLowerCase();
    const player = m[2].trim();
    const pendingKey = [...this.pending.keys()].find(k => this.samePlayer(k, player));
    if (!pendingKey) return false;
    this.pending.delete(pendingKey);
    const entity = Object.values(this.bot.entities).find(e => e.type === 'player' && this.samePlayer(e.username, pendingKey));
    if (decision === 'yes' && entity && !this.isElite(entity.username)) {
      this.attack(entity, 'owner-approved hostile player');
      this.bot.whisper(username, `Attacking ${entity.username}.`);
    } else {
      this.bot.whisper(username, `Not attacking ${pendingKey}.`);
    }
    return true;
  }

  onEntityHurt(entity, source) {
    if (!this.enabled || !entity) return;
    if (entity === this.bot.entity) {
      if (source?.position && source !== this.bot.entity) {
        const name = source.username || source.name || source.displayName || source.displayName || 'unknown';
        if (source.type === 'player' && this.isElite(name)) {
          this.stopCombat();
          return;
        }
        this.attack(source, 'attacked bot');
      }
      return;
    }
    if (entity.type === 'player' && this.isProtected(entity.username) && source?.position) {
      const name = source.username || source.name || source.displayName || source.displayName || 'unknown';
      if (source.type === 'player' && (this.isElite(name) || this.isFriendly(name))) return;
      this.attack(source, `protecting ${entity.username}`);
    }
  }

  scanPlayers() {
    if (!this.enabled) return;
    for (const entity of Object.values(this.bot.entities)) {
      if (entity.type !== 'player' || !entity.username || this.samePlayer(entity.username, this.bot.username)) continue;
      if (this.isElite(entity.username) || this.isFriendly(entity.username)) continue;
      if (this.isHostile(entity.username)) this.askPermission(entity.username);
    }
  }

  maintainProtectedFollow() {
    if (!this.enabled || this.protected.size === 0 || !this.bot.entity) return;
    const candidates = [...this.protected]
      .map(name => this.bot.players[name] || Object.values(this.bot.players).find(p => this.samePlayer(p?.username, name)))
      .filter(p => p?.entity);
    if (!candidates.length) return;
    const target = candidates.sort((a, b) => this.bot.entity.position.distanceTo(a.entity.position) - this.bot.entity.position.distanceTo(b.entity.position))[0];
    if (!target?.entity) return;
    this.currentProtected = target.username;
    try { this.bot.pathfinder.setGoal(new goals.GoalFollow(target.entity, 2), true); } catch {}
  }
}

module.exports = { Security };
