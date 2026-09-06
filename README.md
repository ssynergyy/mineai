# Mineflayer + llama.cpp Autonomous Agent v1.5.1

Autonomous Minecraft bot using Mineflayer for movement/actions and a local llama.cpp OpenAI-compatible server for reasoning.

## Install

```bash
npm install
cp .env.example .env
npm start
```

Edit `.env` for Minecraft/llama settings. `persona.env` contains the separate AI system prompt.

## Survival automation

The local automation layer:

- eats when health is not full or hunger is below half
- equips better armor automatically
- detects when inventory has no recognized food
- reports when its inventory has no food left

The bot does not auto-hunt.

## Trusted owner usernames

Any incoming username containing `EliteSynergy` is trusted locally, case-insensitively. Examples: `EliteSynergy`, `idddEliteSynergygfse`. Commands from those usernames do not require `COMMAND_PASSWORD`.

`!stop` is always handled locally and bypasses the AI completely.

## Player lists

Friendly and hostile lists can start in `.env`, but the owner can also change them in-game with normal AI instructions:

```text
bot, add Steve to friendly
bot, remove Steve from friendly
bot, add Steve to hostile
bot, remove Steve from hostile
bot, list player lists
```

Protected players are intentionally NOT configurable in `.env`. Add/remove them in-game:

```text
bot, protect Steve
bot, stop protecting Steve
bot, list player lists
```

Once protected, the local security layer follows the player. Anything that hurts the protected player is attacked with the best available weapon. The bot also locally defends itself against attackers/mobs. A player whose username contains `EliteSynergy` is never intentionally attacked.

## Tools / abilities

The model can use:

- dig/place blocks
- 2x2 crafting and crafting-table crafting
- furnace, smoker, blast furnace
- furnace output pickup
- enchantment tables
- anvils: rename and combine
- villager trade inspection and trades
- hopper item dropping
- player item delivery
- following and live-entity combat
- arbitrary-length patrol routes
- friendly/hostile/protected player-list management

Examples:

```text
bot, craft 16 bread
bot, smelt 8 beef in the smoker
bot, blast smelt 12 iron ore
bot, enchant my diamond sword with a good option
bot, rename my sword to Guardian
bot, list that villager's trades
bot, trade with villager entity 123 using trade 2 three times
bot, drop 32 cobblestone on the hopper
bot, give 10 bread to Steve
```

Use `get_nearby_entities` first when a command refers to a villager or mob by entity ID.

## Hostile-player approval

Players added to the hostile list are not immediately attacked merely because they are seen. The local security layer whispers the owner:

```text
yes PlayerName
no PlayerName
```

Owner usernames are matched by `EliteSynergy` substring, not exact username.

## Persona

Edit `persona.env` to change the model's system/personality prompt without changing the source code.

## v1.5.1 Queue system
Top-level tasks have five priority levels: `top`, `high`, `medium`, `low`, `background`. The default comes from `DEFAULT_TASK_PRIORITY` in `.env` and the example defaults to `medium`.

Within an equal top-level priority, AI-generated queue notes/tie ranks can decide order; when no useful note exists, the newest task wins.

Complex goals are automatically sent through a planning pass when they look multi-step. The planner can create sub-tasks with `subPriority` from 1-100 and explicit `executeOnlyAfter` dependencies. During a running task the AI can also create more sub-tasks with `queue_subtasks`.

The retry guard tracks repeated failures per task. Two repeated failures of the same tool+arguments are allowed; a third identical failing attempt is blocked and the AI is forced to change strategy.

Security remains outside the normal task queue. Emergency self-defense pauses ordinary work and resumes it afterward. Protection emergencies are higher priority than self-defense. `!stop` clears the entire queue and all security combat state.


## v1.5.4 performance and loop protection
The agent caches automatic llama.cpp model discovery, uses tighter observation/history limits, throttles redundant armor/weapon checks, and includes a loop guard that blocks repeated identical actions when the world state is not changing. Progress-only replies such as 'still working' receive one corrective prompt so the agent either acts, reports a concrete blocker, or finishes.
