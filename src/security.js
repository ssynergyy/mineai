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

    // Security ownership:
    // protected-player defense = 100, bot self-defense = 90.
    // Normal AI/user tasks never override an active security emergency.
    this.emergency = null;
    this.manualPlayerTarget = null;
    this.lastWeaponCheck = 0;
    this.lastWeaponFingerprint = null;
  }

  normalize(name) { return String(name || '').trim().toLowerCase(); }
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

  protectPlayer(name) {
    name = String(name || '').trim();
    if (!name) throw new Error('Player name is required');
    if (this.isElite(name)) throw new Error('EliteSynergy-containing names are owner/trusted, not valid protected targets');
    this.protected.add(name);
    this.currentProtected = null;
    this.maintainProtectedFollow();
    return { protected: [...this.protected], following: Boolean(this.currentProtected) };
  }

  unprotectPlayer(name) {
    return this.remove('protected', name);
  }

  clearSecurityTarget(reason = 'cleared') {
    this.emergency = null;
    this.manualPlayerTarget = null;
    try { this.bot.pvp?.stop(); } catch {}
    try { this.bot.pathfinder?.setGoal(null); } catch {}
    try { this.bot.clearControlStates(); } catch {}
    console.log(`[security] targets cleared: ${reason}`);
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
        ageMs: Date.now() - this.manualPlayerTarget.startedAt,
        lockRemainingMs: Math.max(0, this.manualPlayerTarget.lockUntil - Date.now())
      } : null
    };
  }

  stopCombat() {
    this.clearSecurityTarget('stop');
  }

  onNewUserTask(task) {
    // A player target is protected from accidental task switching for the first 15s.
    // After that, a genuinely new user task may take back control.
    if (!this.manualPlayerTarget || this.emergency) return;
    if (Date.now() < this.manualPlayerTarget.lockUntil) return;

    // A new explicit combat task should establish its own target instead of cancelling twice.
    if (/\b(attack|kill|fight|defend)\b/i.test(String(task?.text || ''))) return;
    this.cancelManualPlayerTarget(`new task #${task?.id ?? '?'}`);
  }

  cancelManualPlayerTarget(reason = 'new task', force = false) {
    if (!this.manualPlayerTarget) return false;
    if (!force && Date.now() < this.manualPlayerTarget.lockUntil) return false;
    this.manualPlayerTarget = null;
    if (!this.emergency) {
      try { this.bot.pvp?.stop(); } catch {}
      try { this.bot.pathfinder?.setGoal(null); } catch {}
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
    const now = Date.now();
    if (now - this.lastWeaponCheck < 500) return this.bot.heldItem;
    this.lastWeaponCheck = now;
    const candidates = this.bot.inventory.items()
      .filter(item => this.weaponScore(item) >= 0)
      .sort((a, b) => this.weaponScore(b) - this.weaponScore(a));
    const item = candidates[0];
    if (!item) return null;
    const fingerprint = `${item.type}:${item.metadata ?? 0}`;
    const held = this.bot.heldItem;
    if ((held && `${held.type}:${held.metadata ?? 0}` === fingerprint) || this.lastWeaponFingerprint === fingerprint) return held || item;
    this.lastWeaponFingerprint = fingerprint;
    try { await this.bot.equip(item, 'hand'); return item; } catch { return null; }
  }

  entityName(entity) {
    return entity?.username || entity?.name || entity?.displayName || 'unknown';
  }

  async startManualCombat(entity, reason = 'user-requested combat') {
    if (!entity?.position || !this.enabled) return false;
    const name = this.entityName(entity);
    if (entity.type === 'player' && this.isElite(name)) return false;

    if (entity.type === 'player') {
      const now = Date.now();
      this.manualPlayerTarget = {
        entityId: entity.id,
        username: name,
        startedAt: now,
        lockUntil: now + 15000
      };
    }

    await this.equipBestWeapon();
    try { this.bot.pvp.attack(entity); } catch { return false; }
    console.log(`[security] manual combat target ${name} (${reason})`);
    return true;
  }

  engageEmergency(entity, reason, priority) {
    if (!entity?.position || !this.enabled) return false;
    const name = this.entityName(entity);
    if (entity.type === 'player' && (this.isElite(name) || this.isFriendly(name))) return false;

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
      ? { entityId: entity.id, username: name, startedAt: Date.now(), lockUntil: Date.now() + 15000 }
      : null;

    try { this.bot.pathfinder?.setGoal(null); } catch {}
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
      void this.startManualCombat(entity, 'owner-approved hostile player');
      this.bot.whisper(username, `Attacking ${entity.username}.`);
    } else {
      this.bot.whisper(username, `Not attacking ${pendingKey}.`);
    }
    return true;
  }

  onEntityHurt(entity, source) {
    if (!this.enabled || !entity || !source?.position) return;

    // Protected-player defense wins over everything else.
    if (entity.type === 'player' && this.isProtected(entity.username)) {
      const name = this.entityName(source);
      if (source.type === 'player' && (this.isElite(name) || this.isFriendly(name))) return;
      this.engageEmergency(source, `protecting ${entity.username}`, 100);
      return;
    }

    // Self-defense is mandatory unless a protected-player defense is already active.
    if (entity === this.bot.entity) {
      const name = this.entityName(source);
      if (source.type === 'player' && this.isElite(name)) {
        if (!this.protected.size) this.stopCombat();
        return;
      }
      if (this.emergency?.priority >= 100) return;
      this.engageEmergency(source, 'attacked bot', 90);
    }
  }

  maintainEmergency() {
    if (this.emergency) {
      const e = this.bot.entities[this.emergency.entityId];
      if (!e?.position || (typeof e.health === 'number' && e.health <= 0)) {
        console.log(`[security] emergency target ended: ${this.emergency.reason}`);
        this.emergency = null;
        this.manualPlayerTarget = null;
        try { this.bot.pvp?.stop(); } catch {}
        this.bot.agent?.resumeAfterSecurity?.();
        return;
      }

      // Keep the emergency active and keep the best weapon equipped.
      void this.equipBestWeapon();
      try { this.bot.pvp.attack(e); } catch {}
      return;
    }

    if (!this.manualPlayerTarget) return;
    const e = this.bot.entities[this.manualPlayerTarget.entityId];
    if (!e?.position || (typeof e.health === 'number' && e.health <= 0)) {
      this.manualPlayerTarget = null;
      try { this.bot.pvp?.stop(); } catch {}
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
    if (this.emergency) return;

    const candidates = [...this.protected]
      .map(name => {
        const exact = this.bot.players[name];
        if (exact?.entity) return exact;
        return Object.values(this.bot.players).find(p => this.samePlayer(p?.username, name));
      })
      .filter(p => p?.entity);
    if (!candidates.length) return;

    const target = candidates.sort((a, b) => this.bot.entity.position.distanceTo(a.entity.position) - this.bot.entity.position.distanceTo(b.entity.position))[0];
    if (!target?.entity) return;
    this.currentProtected = target.username;

    try {
      const current = this.bot.pathfinder.goal;
      const followsSame = current instanceof goals.GoalFollow && current.entity?.id === target.entity.id;
      if (!followsSame) this.bot.pathfinder.setGoal(new goals.GoalFollow(target.entity, 2), true);
    } catch {}
  }
}

module.exports = { Security };
