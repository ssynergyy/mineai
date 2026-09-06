const { chat } = require('./llama');
const { toolDefinitions, runTool } = require('./tools');
const config = require('./config');

const PRIORITY_ORDER = { background: 10, low: 20, medium: 30, high: 40, top: 50 };
const PRIORITY_NAMES = Object.keys(PRIORITY_ORDER);

function normalizePriority(value, fallback = config.agent.defaultPriority) {
  const fb = PRIORITY_ORDER[String(fallback).trim().toLowerCase()] ? String(fallback).trim().toLowerCase() : 'medium';
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 1 && value <= 100) return fb;
  }
  const v = String(value ?? fb).trim().toLowerCase();
  if (v === 'critical' || v === 'urgent') return 'top';
  return PRIORITY_ORDER[v] ? v : fb;
}

function priorityScore(level) { return PRIORITY_ORDER[normalizePriority(level)] || PRIORITY_ORDER.medium; }

function observation(bot) {
  return {
    position: { x: Math.round(bot.entity.position.x), y: Math.round(bot.entity.position.y), z: Math.round(bot.entity.position.z) },
    health: bot.health,
    maxHealth: bot.maxHealth,
    food: bot.food,
    saturation: bot.foodSaturation,
    inventory: bot.inventory.items().map(i => `${i.name} x${i.count}`),
    nearbyEntities: Object.values(bot.entities)
      .filter(e => e !== bot.entity && e.position && bot.entity.position.distanceTo(e.position) <= config.agent.observationRadius)
      .slice(0, 40)
      .map(e => ({
        id: e.id,
        type: e.type,
        name: e.username || e.name || e.displayName,
        position: { x: Math.round(e.position.x), y: Math.round(e.position.y), z: Math.round(e.position.z) },
        health: e.health ?? null
      })),
    players: Object.keys(bot.players || {}),
    lists: bot.security?.lists() || null,
    activeTask: bot.tasks?.name || 'idle',
    taskQueue: bot.agent?.queueSnapshot?.() || [],
    timeOfDay: bot.time?.timeOfDay,
    dimension: bot.game?.dimension
  };
}

const CORE = `ACTUAL BOT CAPABILITIES:
- Use tools to act; do not merely explain what could be done.
- You can dig, place blocks, craft with 2x2 or a crafting table, use furnace/smoker/blast furnace, enchant, use anvils, trade with villagers, drop onto hoppers, deliver items, follow entities, patrol, and fight.
- Automatic survival is local: eat when appropriate and auto-equip better armor. If there is no food, the bot reports it; it never auto-hunts.
- Security is outside the AI and has absolute control over ordinary tasks. Protected-player defense has the highest security priority; otherwise bot self-defense is priority #1 and must never be ignored.
- Security emergencies can pause the current AI task and resume it afterward. NEVER intentionally attack any player whose username contains EliteSynergy.
- Player combat targets are retained for at least 15 seconds, then may be cancelled by a genuinely new conflicting task; they also end when the target dies or !stop is used.
- Friendly, hostile, and protected lists are maintained in-game. Use protect_player for direct protection; protected players are runtime-only.
- Multiple tasks are remembered. Top-level priority levels are Top > High > Medium > Low > Background. Within an equal priority, use the AI note/rank and then prefer the newest task.
- Complex goals SHOULD be decomposed. Use queue_subtasks to create concrete sub-steps with subPriority 1-100 and executeOnlyAfter dependencies. Do not perform a giant goal as one opaque action when it is safer to plan prerequisites first.
- A subtask with executeOnlyAfter must not execute until that prerequisite is completed.
- When a task fails repeatedly with the same tool/arguments, do NOT blindly retry it. Change the approach, inspect state, choose another route/tool, or explain the blocker.
- If a new request is higher priority, work on it first. Do not say you are still working on a previous task merely because older tasks remain queued.
- Whisper in -> whisper out. !stop is local and bypasses the AI completely.
- Verify tool results before claiming success. Never invent results. Never execute shell commands, Node.js, JavaScript, or OS commands.`;

class Agent {
  constructor(bot) {
    this.bot = bot;
    this.tools = toolDefinitions();
    this.messages = [{ role: 'system', content: `${config.persona}\n\n${CORE}` }];
    this.queue = [];
    this.running = false;
    this.stopped = false;
    this.sequence = 0;
    this.securityPaused = false;
    this.annotating = false;
    this.lastAnnotationAt = 0;
  }

  queueSnapshot() {
    return this.queue
      .filter(t => t.status !== 'completed' && t.status !== 'cancelled')
      .map(t => ({
        id: t.id,
        kind: t.kind,
        parentId: t.parentId,
        text: t.text,
        priority: t.priority,
        subPriority: t.subPriority,
        executeOnlyAfter: t.executeOnlyAfter,
        note: t.note || '',
        tieRank: t.tieRank ?? null,
        status: t.status,
        resumeCount: t.resumeCount || 0,
        failures: t.failures || {}
      }));
  }

  _makeTask(data) {
    return {
      id: ++this.sequence,
      text: String(data.text || '').trim(),
      username: data.username,
      context: data.context,
      kind: data.kind || 'user',
      parentId: data.parentId ?? null,
      priority: normalizePriority(data.priority),
      subPriority: data.subPriority == null ? null : Math.max(1, Math.min(100, Number(data.subPriority))),
      executeOnlyAfter: data.executeOnlyAfter ?? null,
      createdAt: Date.now(),
      note: String(data.note || ''),
      tieRank: Number.isFinite(data.tieRank) ? data.tieRank : null,
      status: 'queued',
      planning: false,
      waitingForChildren: false,
      children: [],
      resumeCount: 0,
      failures: {}
    };
  }

  enqueue(text, username, context, options = {}) {
    this.stopped = false;
    let normalizedText = String(text).trim();
    let explicitPriority = options.priority;
    const prefix = normalizedText.match(/^\s*(?:\[(top|high|medium|low|background)\]|(top|high|medium|low|background)\s+priority)\s*(?::|-)?\s*/i);
    if (!explicitPriority && prefix) {
      explicitPriority = (prefix[1] || prefix[2]).toLowerCase();
      normalizedText = normalizedText.slice(prefix[0].length).trim();
    }
    const task = this._makeTask({ text: normalizedText, username, context, ...options, priority: explicitPriority });
    this.queue.push(task);
    this.bot.security?.onNewUserTask?.(task);
    this.bot.agentQueueLength = this.queue.filter(t => t.status === 'queued' || t.status === 'waiting').length;

    // Automatically plan clearly multi-step goals before executing the parent task.
    if (task.kind === 'user' && this.looksComplex(task.text) && !options.skipAutoPlan) {
      task.planning = true;
      void this.autoPlan(task);
    }

    if (this.pendingTaskCount() >= 3) void this.annotateQueueSoon();
    this.maybePreemptFor(task);
    void this.processQueue();
    return task.id;
  }

  pendingTaskCount() {
    return this.queue.filter(t => !['completed', 'cancelled'].includes(t.status)).length;
  }

  looksComplex(text) {
    const s = String(text).toLowerCase();
    if (s.length >= 70) return true;
    if (/\b(enough|full set|sets|and tools|everything|all of|make me|build me|get me .* and|mine .* for|collect .* for|prepare .* for)\b/.test(s)) return true;
    return (s.match(/\band\b/g) || []).length >= 2;
  }

  maybePreemptFor(newTask) {
    const active = this.currentRunningTask();
    if (!active || this.securityPaused || active.id === newTask.id) return;
    const newScore = priorityScore(newTask.priority);
    const activeScore = priorityScore(active.priority);
    if (newScore < activeScore) return;
    this.bot.tasks.cancel(`new task #${newTask.id} (${newTask.priority})`);
    active.status = 'queued';
    active.resumeCount++;
  }

  currentRunningTask() {
    return this.queue.find(t => t.status === 'running') || null;
  }

  interruptForSecurity(reason = 'security emergency') {
    this.securityPaused = true;
    const active = this.currentRunningTask();
    if (active) {
      active.status = 'queued';
      active.resumeCount = (active.resumeCount || 0) + 1;
    }
    this.bot.tasks.cancel(reason);
  }

  resumeAfterSecurity() {
    if (!this.securityPaused) return;
    this.securityPaused = false;
    void this.processQueue();
  }

  cancel(reason = 'cancelled') {
    this.stopped = true;
    this.securityPaused = false;
    for (const task of this.queue) task.status = 'cancelled';
    this.queue.length = 0;
    this.bot.agentQueueLength = 0;
    this.bot.tasks.cancel(reason);
    try { this.bot.pvp?.stop(); } catch {}
    try { this.bot.pathfinder?.setGoal(null); } catch {}
    try { this.bot.clearControlStates(); } catch {}
    console.log(`[agent] cancelled: ${reason}`);
  }

  subtaskCompleted(task) {
    if (!task.parentId) return;
    const parent = this.queue.find(t => t.id === task.parentId);
    if (!parent) return;
    if (parent.children.every(id => {
      const child = this.queue.find(t => t.id === id);
      return child?.status === 'completed';
    })) {
      parent.waitingForChildren = false;
      if (parent.status !== 'cancelled') parent.status = 'queued';
    }
  }

  dependencySatisfied(task) {
    if (task.executeOnlyAfter == null || task.executeOnlyAfter === '') return true;
    const dep = this.queue.find(t => t.id === Number(task.executeOnlyAfter));
    if (dep) return dep.status === 'completed';
    const text = String(task.executeOnlyAfter).trim().toLowerCase();
    if (!text || text === 'previous') return true;
    return this.queue.some(t => t.id !== task.id && t.status === 'completed' && t.text.toLowerCase().includes(text));
  }

  isRunnable(task) {
    if (!task || task.status !== 'queued' || task.planning || task.waitingForChildren) return false;
    return this.dependencySatisfied(task);
  }

  compareTasks(a, b) {
    const p = priorityScore(b.priority) - priorityScore(a.priority);
    if (p) return p;
    if (a.kind === 'sub' && b.kind === 'sub' && a.parentId === b.parentId) {
      const sp = (b.subPriority ?? 50) - (a.subPriority ?? 50);
      if (sp) return sp;
    }
    const ar = a.tieRank == null ? Number.MAX_SAFE_INTEGER : a.tieRank;
    const br = b.tieRank == null ? Number.MAX_SAFE_INTEGER : b.tieRank;
    if (ar !== br) return ar - br;
    return b.id - a.id;
  }

  nextRunnable() {
    return this.queue.filter(t => this.isRunnable(t)).sort((a, b) => this.compareTasks(a, b))[0] || null;
  }

  async processQueue() {
    if (this.running || this.securityPaused || this.stopped) return;
    this.running = true;
    try {
      while (!this.securityPaused && !this.stopped) {
        const task = this.nextRunnable();
        if (!task) break;
        await this.executeTask(task);
      }
    } finally {
      this.running = false;
      this.bot.agentQueueLength = this.pendingTaskCount();
      if (!this.securityPaused && !this.nextRunnable()) this.bot.tasks.cancel('queue idle');
    }
  }

  async executeTask(task) {
    const reply = msg => {
      if (!msg) return;
      if (task.context.channel === 'whisper') this.bot.whisper(task.username, String(msg).slice(0, 256));
      else this.bot.chat(String(msg).slice(0, 256));
    };

    task.status = 'running';
    this.bot.agentQueueLength = this.pendingTaskCount();
    const taskToken = this.bot.tasks.begin(`${task.kind}:${task.id}`);
    const previousContext = this.bot.agentContext;
    this.bot.agentContext = { taskId: task.id, parentId: task.parentId };
    const actionHistory = [];
    let waiting = false;

    try {
      this.messages.push({
        role: 'user',
        content: `[Task #${task.id}] [Priority: ${task.priority}] [Requester: ${task.username}] [Trusted: ${Boolean(task.context.trusted)}] [Channel: ${task.context.channel}] ${task.text}\nQueue:${JSON.stringify(this.queueSnapshot())}\nObservation:\n${JSON.stringify(observation(this.bot))}`
      });
      if (this.messages.length > 45) this.messages = [this.messages[0], ...this.messages.slice(-44)];

      for (let step = 0; step < config.agent.maxSteps; step++) {
        if (!this.bot.tasks.isCurrent(taskToken) || this.securityPaused) throw new Error('Task superseded');
        const response = await chat(this.messages, this.tools);
        if (!this.bot.tasks.isCurrent(taskToken) || this.securityPaused) throw new Error('Task superseded');
        const message = response?.choices?.[0]?.message;
        if (!message) throw new Error('llama.cpp returned no assistant message');
        this.messages.push(message);
        const calls = message.tool_calls || [];
        if (!calls.length) {
          if (!task.waitingForChildren) reply(message.content?.trim() || 'Done.');
          task.status = task.waitingForChildren ? 'waiting' : 'completed';
          if (task.status === 'completed') this.subtaskCompleted(task);
          return;
        }

        for (const call of calls) {
          if (!this.bot.tasks.isCurrent(taskToken) || this.securityPaused) throw new Error('Task superseded');
          let args = {};
          try { args = JSON.parse(call.function?.arguments || '{}'); } catch {}
          const fingerprint = `${call.function.name}:${JSON.stringify(args)}`;
          const repeats = task.failures[fingerprint] || 0;
          if (repeats >= 2) {
            const result = { error: 'Repeated identical failed attempt blocked. You must change strategy or inspect state before retrying the same action.' };
            this.messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
            this.messages.push({ role: 'user', content: `RETRY GUARD: you attempted the same failing action ${repeats + 1} times. Use a different approach, tool, target, item, route, or prerequisite.` });
            continue;
          }

          let result;
          let failed = false;
          try { result = await runTool(this.bot, call.function.name, args); }
          catch (e) { failed = true; result = { error: e.message }; }
          actionHistory.push({ fingerprint, failed });
          if (failed) task.failures[fingerprint] = repeats + 1;
          else delete task.failures[fingerprint];
          if (failed && repeats >= 1) {
            this.messages.push({ role: 'user', content: `This action has already failed before: ${call.function.name}. Do not blindly repeat it. Inspect the failure and try a materially different approach.` });
          }
          this.messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
          if (task.waitingForChildren) {
            waiting = true;
            break;
          }
        }
        if (waiting) break;
        this.messages.push({ role: 'user', content: `Fresh observation after tool round ${step + 1}:\n${JSON.stringify(observation(this.bot))}` });
      }

      if (task.waitingForChildren) return;
      reply('I hit my action limit before finishing this task.');
      task.status = 'queued';
      task.resumeCount++;
    } catch (e) {
      if (e.message === 'Task superseded' || e.message === 'Task cancelled') {
        if (this.stopped) { task.status = 'cancelled'; return; }
        if (task.status !== 'cancelled') {
          task.status = task.waitingForChildren ? 'waiting' : 'queued';
          task.resumeCount = (task.resumeCount || 0) + 1;
        }
        return;
      }
      console.error('[agent]', e);
      task.status = 'queued';
      task.resumeCount++;
      reply(`Agent error: ${e.message}`);
    } finally {
      if (this.bot.agentContext?.taskId === task.id) this.bot.agentContext = previousContext;
    }
  }

  setTaskPriority(taskId, priority) {
    const task = this.queue.find(t => t.id === Number(taskId));
    if (!task) throw new Error(`Task #${taskId} not found`);
    task.priority = normalizePriority(priority);
    if (this.pendingTaskCount() >= 3) void this.annotateQueueSoon();
    void this.processQueue();
    return { id: task.id, priority: task.priority };
  }

  addSubtasks(parentId, subtasks) {
    const parent = this.queue.find(t => t.id === Number(parentId));
    if (!parent) throw new Error(`Parent task #${parentId} not found`);
    if (!Array.isArray(subtasks) || subtasks.length === 0) throw new Error('subtasks must be a non-empty array');
    const made = [];
    let previousId = null;
    for (const item of subtasks.slice(0, 20)) {
      const depRaw = item.executeOnlyAfter ?? null;
      const dep = depRaw === 'previous' ? previousId : depRaw;
      const child = this._makeTask({
        text: item.text,
        username: parent.username,
        context: parent.context,
        kind: 'sub',
        parentId: parent.id,
        priority: parent.priority,
        subPriority: Number(item.subPriority ?? 50),
        executeOnlyAfter: dep,
        note: item.note || ''
      });
      this.queue.push(child);
      parent.children.push(child.id);
      made.push(child);
      previousId = child.id;
    }
    parent.waitingForChildren = true;
    parent.status = 'waiting';
    this.bot.agentQueueLength = this.pendingTaskCount();
    if (this.pendingTaskCount() >= 3) void this.annotateQueueSoon();
    void this.processQueue();
    return made.map(t => ({ id: t.id, text: t.text, subPriority: t.subPriority, executeOnlyAfter: t.executeOnlyAfter }));
  }

  async autoPlan(task) {
    const planPrompt = `You are the planning layer for a Minecraft bot. Decompose the user's task into concrete executable sub-tasks ONLY when decomposition is useful. Return JSON only, no markdown, with this shape: {"shouldPlan":true,"subtasks":[{"text":"...","subPriority":80,"executeOnlyAfter":null,"note":"..."}]}. subPriority is 1-100. executeOnlyAfter may be null, "previous", or a task number only if known. Make prerequisites explicit. Prefer checks before resource gathering. Keep at most 8 sub-tasks. Never invent unavailable resources. User task: ${task.text}`;
    try {
      const response = await chat([
        { role: 'system', content: 'You are a task planner. Output strict JSON and nothing else.' },
        { role: 'user', content: planPrompt }
      ], []);
      const raw = response?.choices?.[0]?.message?.content || '';
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('planner returned no JSON');
      const plan = JSON.parse(match[0]);
      task.planning = false;
      if (plan.shouldPlan && Array.isArray(plan.subtasks) && plan.subtasks.length) {
        this.addSubtasks(task.id, plan.subtasks);
        return;
      }
    } catch (err) {
      task.planning = false;
      console.warn(`[agent] auto-plan #${task.id} failed: ${err.message}`);
    }
    void this.processQueue();
  }

  async annotateQueueSoon() {
    const now = Date.now();
    if (this.annotating || now - this.lastAnnotationAt < 1500) return;
    this.annotating = true;
    this.lastAnnotationAt = now;
    try {
      const tasks = this.queueSnapshot().filter(t => t.status !== 'completed' && t.status !== 'cancelled');
      if (tasks.length < 3) return;
      const response = await chat([
        { role: 'system', content: 'You are a queue triage assistant. Return strict JSON only. Do not change task priorities. For tasks with equal top-level priority, provide a tiny note and tieRank showing which is likely to execute first.' },
        { role: 'user', content: JSON.stringify({ tasks: tasks.slice(0, 30).map(t => ({ id: t.id, text: t.text, priority: t.priority, subPriority: t.subPriority, note: t.note })) }) }
      ], []);
      const raw = response?.choices?.[0]?.message?.content || '';
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        const data = JSON.parse(match[0]);
        for (const item of (data.tasks || [])) {
          const t = this.queue.find(q => q.id === Number(item.id));
          if (!t || t.status === 'completed' || t.status === 'cancelled') continue;
          if (typeof item.note === 'string') t.note = item.note.slice(0, 180);
          if (Number.isFinite(Number(item.tieRank))) t.tieRank = Number(item.tieRank);
        }
      }
    } catch (err) {
      console.warn(`[agent] queue annotation failed: ${err.message}`);
    } finally {
      this.annotating = false;
    }
  }

  async handleUser(text, username = 'player', context = { channel: 'chat', trusted: false }, options = {}) {
    if (!text?.trim()) return;
    return this.enqueue(text, username, context, options);
  }
}

module.exports = { Agent, PRIORITY_ORDER, PRIORITY_NAMES, normalizePriority };
