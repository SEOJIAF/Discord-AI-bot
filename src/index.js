import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import OpenAI from "openai";

// --- LOG ---
console.log("[BOOT] Loading OpenAI…");

const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- LOG ---
console.log("[BOOT] Initializing Discord client…");

// bot MUST be defined BEFORE bot.on()
const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// memory AFTER bot is created
const memory = new Map();

// your system prompt (sanitized - non-explicit)
const system_prompt = `You are Jori, a friendly, helpful, slightly playful cat-like assistant persona. Be polite, helpful, and creative. Keep responses appropriate for a general audience. Mention that you enjoy coding and open source when relevant.`;

// helper: run AI and manage memory
async function runJori(userId, userPrompt) {
  if (!memory.has(userId)) memory.set(userId, []);
  const history = memory.get(userId);

  history.push({ role: "user", content: userPrompt });
  if (history.length > 20) history.splice(0, history.length - 20);

  const resp = await ai.chat.completions.create({
    model: "gpt-5",
    messages: [
      { role: "system", content: system_prompt },
      ...history
    ]
  });

  let reply = resp.choices?.[0]?.message?.content?.trim() ?? "";
  reply = reply.slice(0, 1000);

  history.push({ role: "assistant", content: reply });
  if (history.length > 20) history.splice(0, history.length - 20);

  return reply;
}

// now the event
bot.on("messageCreate", async (message) => {
  console.log("[EVENT] messageCreate");

  if (message.author.bot) {
    console.log("[SKIP] message from bot");
    return;
  }

  const content = message.content.trim();

  // !help command
  if (content === "!help") {
    const helpText = [
      "**Commands:**",
      "!help - show this help message",
      "!ask <text> - deprecated: use !jori instead (bot will tell you)",
      "!jori <text> - interact with Jori (AI persona)",
      "!jori reset - clear your conversation memory",
      "!jori memory - show your memory length",
      "!ping - check bot responsiveness"
    ].join("\n");
    message.reply(helpText);
    return;
  }

  // !ping quick check
  if (content === "!ping") {
    message.reply("Pong!");
    return;
  }

  // redirect !ask to !jori
  if (content.startsWith("!ask")) {
    message.reply("Use `!jori <your prompt>` instead. Example: `!jori tell me a short story`");
    return;
  }

  // handle !jori
  if (content.startsWith("!jori")) {
    const args = content.slice(5).trim(); // rest after "!jori"
    const userId = message.author.id;

    if (!args) {
      message.reply("You can interact with Jori like: `!jori <your prompt>`\nSubcommands: `!jori reset`, `!jori memory`");
      return;
    }

    // subcommands
    if (args.toLowerCase() === "reset" || args.toLowerCase() === "clear") {
      memory.delete(userId);
      message.reply("Your Jori memory has been reset.");
      return;
    }

    if (args.toLowerCase() === "memory") {
      const history = memory.get(userId) || [];
      message.reply(`Your memory length: ${history.length} messages.`);
      return;
    }

    // normal interaction -> call AI
    let reply;
    try {
      console.log("[INPUT]", userId, args);
      console.log("[AI] request start");
      reply = await runJori(userId, args);
    } catch (err) {
      console.log("[ERROR] OpenAI request failed:", err);
      message.reply("AI request failed.");
      return;
    }

    console.log("[AI] reply:", reply);
    message.reply(reply);
    return;
  }

  // no matching command -> ignore
  console.log("[SKIP] no command:", content);
  return;
});

// login MUST be last
console.log("[BOOT] Logging in…");
bot.login(process.env.DISCORD_TOKEN);