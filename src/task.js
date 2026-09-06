class TaskManager {
  constructor() {
    this.generation = 0;
    this.name = 'idle';
    this.active = null;
    this.reason = null;
  }

  begin(name = 'task') {
    const task = { token: ++this.generation, name: String(name), startedAt: Date.now() };
    this.active = task;
    this.name = task.name;
    this.reason = null;
    return task.token;
  }

  start(name = 'task') {
    return this.begin(name);
  }

  cancel(reason = 'cancelled') {
    this.generation++;
    this.active = null;
    this.name = 'idle';
    this.reason = reason;
    return this.generation;
  }

  currentToken() {
    return this.active?.token ?? null;
  }

  isCurrent(token) {
    return token !== null && token !== undefined && token === this.active?.token && token === this.generation;
  }

  isActive() {
    return Boolean(this.active);
  }
}

module.exports = { TaskManager };
