class TaskManager {
  constructor() { this.generation = 0; this.name = "idle"; }
  start(name = "task") { this.name = name; return ++this.generation; }
  cancel() { ++this.generation; this.name = "idle"; }
  isCurrent(token) { return token === this.generation; }
}
module.exports = { TaskManager };
