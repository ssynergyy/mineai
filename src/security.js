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

    // Security priority: protected-player defense > bot self-defense > ordinary combat/user tasks.
    this.emergency = null; // { entityId, reason, priority, startedAt, playerTarget }
    this.manualPlayerTarget = null; // { entityId, username, startedAt }
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
    if (list === 'protected') this.currentProtected = null;
    return { [list]: [...this[list]] };
  }

  remove(list, name) {
    name = String(name || '').trim();
    const actual = [...this[list]].find(n => this.samePlayer(n, name));
    if (actual) this[list].delete(actual);
    if (list === 'protected' && this.currentProtected && this.samePlayer(this.currentProtected, name)) {
      this.currentProtected = null;
      if (!this.emergency) {
        try { this.bot.pathfinder?.setGoal(null); } catch {}
      }
    }
    return { [list]: [...this[list]] };
  }

  lists() {
    return {
      owner: this.owner,
      friendly: [...this.friendly],
      hostile: [...this.hostile],
      protected: [...this.protected],
      pendingPermissions: [...this.pending.keys()],
      emergency: this.emergency ? {
        target: this.emergency.entityId,
        reason: this.emergency.reason,
        priority: this.emergency.priority,
        playerTarget: this.emergency.playerTarget,
        ageMs: Date.now() - this.emergency.startedAt
      } : null,
      manualPlayerTarget: this.manualPlayerTarget ? {
        target: this.manualPlayerTarget.username,
        ageMs: Date.now() - this.manualPlayerTarget.startedAt
      } : null
    };
  }

  stopCombat() {
    this.emergency = null;
    this.manualPlayerTarget = null;
    try { this.bot.pvp?.stop(); } catch {}
    try { this.bot.pathfinder?.setGoal(null); } catch {}
    try { this.bot.clearControlStates(); } catch {}
  }

  cancelManualPlayerTarget(reason = 'new task') {
    if (!this.manualPlayerTarget) return false;
    this.manualPlayerTarget = null;
    // An emergency target still owns combat; do not cancel it.
    if (!this.emergency) {
      try { this.bot.pvp?.stop(); } catch {}
    }
    console.log(`[security] manual player target cancelled: ${reason}`);
    return true;
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

  entityName(entity) {
    return entity?.username || entity?.name || entity?.displayName || 'unknown';
  }

  entityStillValid(entityId) {
    const entity = this.bot.entities[entityId];
    return entity && entity.position && (entity.type !== 'player' || entity.username);
  }

  async startManualCombat(entity, reason = 'user-requested combat') {
    if (!entity?.position || !this.enabled) return false;
    const name = this.entityName(entity);
    if (entity.type === 'player' && this.isElite(name)) return false;

    if (entity.type === 'player') {
      this.manualPlayerTarget = {
        entityId: entity.id,
        username: name,
        startedAt: Date.now()
      };
    }

    await this.equipBestWeapon();
    this.bot.pvp.attack(entity);
    console.log(`[security] manual combat target ${name} (${reason})`);
    return true;
  }

  async engage(entity, reason, priority = 50, lockedPlayer = false) {
    if (!entity?.position || !this.enabled) return false;
    const name = this.entityName(entity);
    if (entity.type === 'player' && this.isElite(name)) return false;

    await this.equipBestWeapon();
    this.bot.pvp.attack(entity);
    console.log(`[security] attacking ${name} (${reason})`);

    if (lockedPlayer || entity.type === 'player') {
      this.manualPlayerTarget = {
        entityId: entity.id,
        username: name,
        startedAt: Date.now()
      };
    }
    return true;
  }

  engageEmergency(entity, reason, priority) {
    if (!entity?.position || !this.enabled) return false;
    const name = this.entityName(entity);
    if (entity.type === 'player' && (this.isElite(name) || this.isFriendly(name))) {
      return false;
    }

    const existingPriority = this.emergency?.priority ?? -1;
    if (this.emergency && this.emergency.priority > priority) return false;

    this.bot.agent?.interruptForSecurity?.(`security emergency: ${reason}`);
    this.emergency = {
      entityId: entity.id,
      reason,
      priority,
      startedAt: Date.now(),
      playerTarget: entity.type === 'player'
    };
    this.manualPlayerTarget = entity.type === 'player'
      ? { entityId: entity.id, username: name, startedAt: Date.now() }
      : null;

    void this.equipBestWeapon();
    try { this.bot.pvp.attack(entity); } catch (err) { console.error('[security] pvp:', err.message); }
    console.log(`[security] EMERGENCY target ${name} (${reason}, priority ${priority})`);
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
      void this.engage(entity, 'owner-approved hostile player', 60, true);
      this.bot.whisper(username, `Attacking ${entity.username}.`);
    } else {
      this.bot.whisper(username, `Not attacking ${pendingKey}.`);
    }
    return true;
  }

  onEntityHurt(entity, source) {
    if (!this.enabled || !entity || !source?.position) return;

    if (entity === this.bot.entity) {
      const name = this.entityName(source);
      if (source.type === 'player' && this.isElite(name)) {
        // EliteSynergy-containing users can never become an attack target.
        if (!this.protected.size) this.stopCombat();
        return;
      }

      // Self-defense is priority 90, below protected-player defense at 100.
      this.engageEmergency(source, 'attacked bot', 90);
      return;
    }

    if (entity.type === 'player' && this.isProtected(entity.username)) {
      const name = this.entityName(source);
      if (source.type === 'player' && (this.isElite(name) || this.isFriendly(name))) return;

      // Protecting a protected player is the highest security priority.
      this.engageEmergency(source, `protecting ${entity.username}`, 100);
    }
  }

  maintainEmergency() {
    if (!this.emergency) {
      if (this.manualPlayerTarget) {
        const e = this.bot.entities[this.manualPlayerTarget.entityId];
        const elapsed = Date.now() - this.manualPlayerTarget.startedAt;
        if (e?.position) {
          void this.equipBestWeapon();
          try { this.bot.pvp.attack(e); } catch {}
        } else if (elapsed >= 15000) {
          this.manualPlayerTarget = null;
        }
      }
      return;
    }

    const e = this.bot.entities[this.emergency.entityId];
    if (!e?.position || (typeof e.health === 'number' && e.health <= 0)) {
      console.log(`[security] emergency target ended: ${this.emergency.reason}`);
      this.emergency = null;
      this.manualPlayerTarget = null;
      try { this.bot.pvp?.stop(); } catch {}
      this.bot.agent?.resumeAfterSecurity?.();
      return;
    }

    void this.equipBestWeapon();
    try { this.bot.pvp.attack(e); } catch {}
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

    // Any emergency defense owns movement. Do not let follow overwrite its path.
    if (this.emergency) return;

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
