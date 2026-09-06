from pathlib import Path
import json, re
root=Path('/mnt/data/reviewv153')

# llama.js: cache model + configurable timeout
p=root/'src/llama.js'
s=p.read_text()
s=s.replace('const config = require("./config");\n', 'const config = require("./config");\nlet cachedModel = null;\n')
s=s.replace('async function request(path, body, timeoutMs = 120000) {', 'async function request(path, body, timeoutMs = config.llama.timeoutMs) {')
s=s.replace('async function getModel() {\n  if (config.llama.model) return config.llama.model;\n', 'async function getModel() {\n  if (config.llama.model) return config.llama.model;\n  if (cachedModel) return cachedModel;\n')
s=s.replace('  if (!model) throw new Error("llama.cpp returned no model from /v1/models");\n  return model;\n', '  if (!model) throw new Error("llama.cpp returned no model from /v1/models");\n  cachedModel = model;\n  return model;\n')
p.write_text(s)

# config: tune defaults / loop options
p=root/'src/config.js'
s=p.read_text()
s=s.replace("    model: process.env.LLAMA_MODEL || ''\n", "    model: process.env.LLAMA_MODEL || '',\n    timeoutMs: number('LLAMA_TIMEOUT_MS', 60000)\n")
s=s.replace("    maxSteps: number('AGENT_MAX_STEPS', 24),", "    maxSteps: number('AGENT_MAX_STEPS', 20),")
s=s.replace("    maxTokens: number('AGENT_MAX_TOKENS', 900),", "    maxTokens: number('AGENT_MAX_TOKENS', 800),")
s=s.replace("    observationRadius: number('AGENT_OBSERVATION_RADIUS', 20),", "    observationRadius: number('AGENT_OBSERVATION_RADIUS', 16),\n    maxHistoryMessages: number('AGENT_MAX_HISTORY_MESSAGES', 30),\n    loopGuard: bool('AGENT_LOOP_GUARD', true),\n    loopRepeatLimit: number('AGENT_LOOP_REPEAT_LIMIT', 2),")
p.write_text(s)

# env example
p=root/'.env.example'
s=p.read_text()
s=s.replace('LLAMA_MODEL=\n', 'LLAMA_MODEL=\nLLAMA_TIMEOUT_MS=60000\n')
s=s.replace('AGENT_MAX_STEPS=24\n', 'AGENT_MAX_STEPS=20\n')
s=s.replace('AGENT_MAX_TOKENS=900\n', 'AGENT_MAX_TOKENS=800\n')
s=s.replace('AGENT_OBSERVATION_RADIUS=20\n', 'AGENT_OBSERVATION_RADIUS=16\nAGENT_MAX_HISTORY_MESSAGES=30\nAGENT_LOOP_GUARD=true\nAGENT_LOOP_REPEAT_LIMIT=2\n')
p.write_text(s)

# package version
p=root/'package.json'
data=json.loads(p.read_text()); data['version']='1.5.4'; p.write_text(json.dumps(data, indent=2)+'\n')

# automation: cache armor fingerprint + run every 1s
p=root/'src/automation.js'
s=p.read_text()
s=s.replace('    this.noFoodAnnounced = false;\n', '    this.noFoodAnnounced = false;\n    this.lastArmorFingerprint = null;\n    this.lastArmorCheck = 0;\n')
old="""  async equipBestArmor() {\n    if (this.busyArmor || !this.config.automation.autoEquipArmor || !this.bot.entity) return;\n    this.busyArmor = true;\n    try {\n      for (const destination of ['head','torso','legs','feet']) {\n        const slot = this.bot.getEquipmentDestSlot(destination);\n        const equipped = this.bot.inventory.slots[slot];\n        const currentRank = this.armorRank(equipped);\n        const candidates = this.bot.inventory.items()\n          .filter(i => this.armorDestination(i.name) === destination)\n          .sort((a, b) => this.armorRank(b) - this.armorRank(a));\n        if (candidates[0] && this.armorRank(candidates[0]) > currentRank) await this.bot.equip(candidates[0], destination);\n      }\n    } catch (err) {\n      console.log(`[automation] armor: ${err.message}`);\n    } finally {\n      this.busyArmor = false;\n    }\n  }\n"""
new="""  async equipBestArmor() {\n    if (this.busyArmor || !this.config.automation.autoEquipArmor || !this.bot.entity) return;\n    const now = Date.now();\n    if (now - this.lastArmorCheck < 1000) return;\n    const fingerprint = ['head','torso','legs','feet'].map(destination => {\n      const slot = this.bot.getEquipmentDestSlot(destination);\n      const equipped = this.bot.inventory.slots[slot];\n      const best = this.bot.inventory.items()\n        .filter(i => this.armorDestination(i.name) === destination)\n        .sort((a, b) => this.armorRank(b) - this.armorRank(a))[0];\n      return `${destination}:${equipped?.type ?? 0}:${best?.type ?? 0}:${best?.count ?? 0}`;\n    }).join('|');\n    this.lastArmorCheck = now;\n    if (fingerprint === this.lastArmorFingerprint) return;\n    this.lastArmorFingerprint = fingerprint;\n    this.busyArmor = true;\n    try {\n      for (const destination of ['head','torso','legs','feet']) {\n        const slot = this.bot.getEquipmentDestSlot(destination);\n        const equipped = this.bot.inventory.slots[slot];\n        const currentRank = this.armorRank(equipped);\n        const candidates = this.bot.inventory.items()\n          .filter(i => this.armorDestination(i.name) === destination)\n          .sort((a, b) => this.armorRank(b) - this.armorRank(a));\n        if (candidates[0] && this.armorRank(candidates[0]) > currentRank) await this.bot.equip(candidates[0], destination);\n      }\n    } catch (err) {\n      console.log(`[automation] armor: ${err.message}`);\n    } finally {\n      this.busyArmor = false;\n    }\n  }\n"""
if old not in s: raise SystemExit('automation block not found')
s=s.replace(old,new)
s=s.replace("  async tick() {\n", "  async tick() {\n")
p.write_text(s)

# index timer 1 sec instead of 2.5
p=root/'src/index.js'; s=p.read_text(); s=s.replace('automationTimer = setInterval(() => { void automation?.tick(); }, 2500);', 'automationTimer = setInterval(() => { void automation?.tick(); }, 1000);'); p.write_text(s)

# security: throttle weapon equip
p=root/'src/security.js'; s=p.read_text()
s=s.replace('    this.manualPlayerTarget = null;\n', '    this.manualPlayerTarget = null;\n    this.lastWeaponCheck = 0;\n    this.lastWeaponFingerprint = null;\n', 1)
old="""  async equipBestWeapon() {\n    const candidates = this.bot.inventory.items()\n      .filter(item => this.weaponScore(item) >= 0)\n      .sort((a, b) => this.weaponScore(b) - this.weaponScore(a));\n    const item = candidates[0];\n    if (!item) return null;\n    const held = this.bot.heldItem;\n    if (held && held.type === item.type && held.metadata === item.metadata) return held;\n    try { await this.bot.equip(item, 'hand'); return item; } catch { return null; }\n  }\n"""
new="""  async equipBestWeapon() {\n    const now = Date.now();\n    if (now - this.lastWeaponCheck < 500) return this.bot.heldItem;\n    this.lastWeaponCheck = now;\n    const candidates = this.bot.inventory.items()\n      .filter(item => this.weaponScore(item) >= 0)\n      .sort((a, b) => this.weaponScore(b) - this.weaponScore(a));\n    const item = candidates[0];\n    if (!item) return null;\n    const fingerprint = `${item.type}:${item.metadata ?? 0}`;\n    const held = this.bot.heldItem;\n    if ((held && `${held.type}:${held.metadata ?? 0}` === fingerprint) || this.lastWeaponFingerprint === fingerprint) return held || item;\n    this.lastWeaponFingerprint = fingerprint;\n    try { await this.bot.equip(item, 'hand'); return item; } catch { return null; }\n  }\n"""
if old not in s: raise SystemExit('weapon block not found')
s=s.replace(old,new)
p.write_text(s)

# agent: compact observation, history bound, loop guard, status-like response guard
p=root/'src/agent.js'; s=p.read_text()
s=s.replace("      nearbyEntities: Object.values(bot.entities)\n", "      nearbyEntities: Object.values(bot.entities)\n")
s=s.replace("      .slice(0, 40)\n", "      .slice(0, 24)\n")
s=s.replace("    inventory: bot.inventory.items().map(i => `${i.name} x${i.count}`),", "    inventory: bot.inventory.items().map(i => `${i.name} x${i.count}`).slice(0, 36),")
s=s.replace("      this.messages.push({\n        role: 'user',\n        content: `[Task #${task.id}]", "      this.messages.push({\n        role: 'user',\n        content: `[Task #${task.id}]")
s=s.replace("      if (this.messages.length > 45) this.messages = [this.messages[0], ...this.messages.slice(-44)];", "      const maxHistory = Math.max(10, config.agent.maxHistoryMessages);\n      if (this.messages.length > maxHistory + 1) this.messages = [this.messages[0], ...this.messages.slice(-(maxHistory))];")
# insert loop state before for
needle="""      for (let step = 0; step < config.agent.maxSteps; step++) {\n"""
replace="""      let loopState = null;\n      let progresslessRounds = 0;\n      let statusLikeFollowupUsed = false;\n      for (let step = 0; step < config.agent.maxSteps; step++) {\n"""
if needle not in s: raise SystemExit('loop insert point not found')
s=s.replace(needle,replace)
# Replace no calls block
old="""        if (!calls.length) {\n          if (!task.waitingForChildren) reply(message.content?.trim() || 'Done.');\n          task.status = task.waitingForChildren ? 'waiting' : 'completed';\n          if (task.status === 'completed') this.subtaskCompleted(task);\n          return;\n        }\n"""
new="""        if (!calls.length) {\n          const text = String(message.content || '').trim();\n          const looksLikeStatus = /\\b(still working|working on it|one moment|give me a moment|processing|i'm working|im working)\\b/i.test(text);\n          if (looksLikeStatus && !task.waitingForChildren && !statusLikeFollowupUsed) {\n            statusLikeFollowupUsed = true;\n            this.messages.push({ role: 'user', content: 'Do not give a progress-only reply. Either perform the next concrete action with a tool, state a specific blocker, or confirm the task is actually complete.' });\n            continue;\n          }\n          if (!task.waitingForChildren) reply(text || 'Done.');\n          task.status = task.waitingForChildren ? 'waiting' : 'completed';\n          if (task.status === 'completed') this.subtaskCompleted(task);\n          return;\n        }\n"""
if old not in s: raise SystemExit('no calls block not found')
s=s.replace(old,new)
# Insert loop guard before existing failure guard
needle="""          const fingerprint = `${call.function.name}:${JSON.stringify(args)}`;\n          const repeats = task.failures[fingerprint] || 0;\n"""
replace="""          const fingerprint = `${call.function.name}:${JSON.stringify(args)}`;\n          const stateBefore = JSON.stringify({\n            position: observation(this.bot).position,\n            health: this.bot.health,\n            food: this.bot.food,\n            inventory: this.bot.inventory.items().reduce((m, i) => { m[i.name] = (m[i.name] || 0) + i.count; return m; }, {})\n          });\n          const loopKey = `${fingerprint}|${stateBefore}`;\n          const repeats = task.failures[fingerprint] || 0;\n          if (config.agent.loopGuard && loopState?.key === loopKey && loopState.count >= config.agent.loopRepeatLimit) {\n            const result = { error: 'Loop guard: the same action is being repeated without meaningful state change. Choose a different strategy or inspect the current state.' };\n            this.messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });\n            this.messages.push({ role: 'user', content: 'LOOP GUARD TRIGGERED. Stop repeating the same action with the same state. Use a different tool/target/route or explain the concrete blocker.' });\n            loopState = null;\n            progresslessRounds++;\n            continue;\n          }\n"""
if needle not in s: raise SystemExit('fingerprint point not found')
s=s.replace(needle,replace)
# after runTool result update loopState. Find after failed handling
needle="""          if (failed && repeats >= 1) {\n            this.messages.push({ role: 'user', content: `This action has already failed before: ${call.function.name}. Do not blindly repeat it. Inspect the failure and try a materially different approach.` });\n          }\n          this.messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });\n"""
replace="""          if (failed && repeats >= 1) {\n            this.messages.push({ role: 'user', content: `This action has already failed before: ${call.function.name}. Do not blindly repeat it. Inspect the failure and try a materially different approach.` });\n          }\n          const stateAfter = JSON.stringify({\n            position: observation(this.bot).position,\n            health: this.bot.health,\n            food: this.bot.food,\n            inventory: this.bot.inventory.items().reduce((m, i) => { m[i.name] = (m[i.name] || 0) + i.count; return m; }, {})\n          });\n          if (config.agent.loopGuard && !failed) {\n            const noProgress = stateBefore === stateAfter;\n            if (loopState?.key === loopKey && noProgress) loopState.count += 1;\n            else loopState = { key: loopKey, count: noProgress ? 1 : 0 };\n            progresslessRounds = noProgress ? progresslessRounds + 1 : 0;\n          } else {\n            loopState = null;\n            progresslessRounds = 0;\n          }\n          this.messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });\n"""
if needle not in s: raise SystemExit('state update point not found')
s=s.replace(needle,replace)
# Add loop budget after tool round observation perhaps
needle="""        this.messages.push({ role: 'user', content: `Fresh observation after tool round ${step + 1}:\\n${JSON.stringify(observation(this.bot))}` });\n"""
replace="""        this.messages.push({ role: 'user', content: `Fresh observation after tool round ${step + 1}:\\n${JSON.stringify(observation(this.bot))}` });\n        if (config.agent.loopGuard && progresslessRounds >= 4) {\n          this.messages.push({ role: 'user', content: 'The bot state has not changed across repeated actions. Change strategy now; do not repeat the same tool call.' });\n          progresslessRounds = 0;\n        }\n"""
if needle not in s: raise SystemExit('observation point not found')
s=s.replace(needle,replace)
# Observe less queue detail? active task queue can be large. cap queue snapshot by 12
s=s.replace("    taskQueue: bot.agent?.queueSnapshot?.() || [],", "    taskQueue: (bot.agent?.queueSnapshot?.() || []).slice(0, 12),")
p.write_text(s)

# README version note
p=root/'README.md'; s=p.read_text(); s += "\n\n## v1.5.4 performance and loop protection\nThe agent caches automatic llama.cpp model discovery, uses tighter observation/history limits, throttles redundant armor/weapon checks, and includes a loop guard that blocks repeated identical actions when the world state is not changing. Progress-only replies such as 'still working' receive one corrective prompt so the agent either acts, reports a concrete blocker, or finishes.\n"; p.write_text(s)
