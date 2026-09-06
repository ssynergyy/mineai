require("dotenv").config();

const mineflayer = require("mineflayer");
const { pathfinder, Movements } = require("mineflayer-pathfinder");
const config = require("./config");
const { Agent } = require("./agent");

console.log("Starting Mineflayer + llama.cpp agent...");
console.log(`Minecraft: ${config.minecraft.host}:${config.minecraft.port}`);
console.log(`Username:   ${config.minecraft.username}`);
console.log(`llama.cpp:  ${config.llama.baseUrl}`);

const bot = mineflayer.createBot(config.minecraft);

bot.loadPlugin(pathfinder);

let agent;

bot.once("spawn", () => {
  const movements = new Movements(bot);
  movements.canDig = true;
  movements.allow1by1towers = false;
  bot.pathfinder.setMovements(movements);

  agent = new Agent(bot);

  console.log(`[bot] Spawned at ${bot.entity.position}`);
  console.log("[bot] AI agent ready.");
});

bot.on("chat", (username, message) => {
  if (username === bot.username) return;

  const text = message.trim();
  if (!text) return;

  // Commands addressed as "bot, ..." or "bot: ..."
  const lower = text.toLowerCase();
  const prefix = bot.username.toLowerCase();

  if (lower.startsWith("bot,") || lower.startsWith("bot:") || lower.startsWith(prefix + " ")) {
    const command = text.replace(/^[^,: ]+[\s,:]+/i, "").trim();
    if (command && agent) agent.handleUser(command, username);
  }
});

bot.on("whisper", (username, message) => {
  if (username === bot.username || !agent) return;
  agent.handleUser(message, username);
});

bot.on("kicked", reason => console.log("[bot] Kicked:", reason));
bot.on("error", error => console.error("[bot] Error:", error));
bot.on("end", () => {
  console.log("[bot] Connection ended. Exiting.");
  process.exit(1);
});
