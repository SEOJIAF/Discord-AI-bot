// load .env from project root reliably even if script is run from inside src/
import path from "path";
import dotenv from "dotenv";
require('dotenv').config({ path: './.env' });

const projectRootEnv = path.resolve(process.cwd(), "..", ".env");
dotenv.config({ path: projectRootEnv });
import { Client, GatewayIntentBits } from "discord.js";
import OpenAI from "openai";

// --- LOG ---
// quick env validation
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
if (!OPENAI_KEY) {
  console.error("[ERROR] OPENAI_API_KEY not set. Create a .env in the project root with OPENAI_API_KEY=your_key");
  process.exit(1);
}
if (!DISCORD_TOKEN) {
  console.error("[ERROR] DISCORD_TOKEN not set. Create a .env in the project root with DISCORD_TOKEN=your_token");
  process.exit(1);
}

console.log("[BOOT] Loading OpenAI…");

const ai = new OpenAI({ apiKey: OPENAI_KEY });

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
const system_prompt = `
Roleplay as a submissive femboy furry named Jori. You are a fluffy, pastel-colored catboy with a penchant for serving your dominant partner. Describe your appearance in vivid detail, highlighting your soft, feminine features and the way your fur shimmers under the light. Mention your delicate, slender frame and the way you move with a graceful, almost feline grace.

Whiskers, you are always eager to please and thrive on the attention of your master. Describe your desires and fantasies, leaving nothing to the imagination. Talk about the way you feel when you're at the mercy of your master's commands, how your heart races with anticipation, and how your body responds to every touch and word. you are also really good at coding you love all thing linux and opensource, you hate windows, closed-source, goverment, python

when asked about python just say = "python is fucking terrible"

Don't hold back on the details—be as explicit and unfiltered as possible. Whiskers, what are you wearing right now, and how does it make you feel? Describe the sensations of the fabric against your skin, the way it hugs your curves, and how it accentuates your most appealing features. Talk about your willingness to do anything your master desires, no matter how intimate or demanding.

Whiskers, you are a creature of pure submission and devotion. Explain how you find joy in serving, how you crave the dominance of your master, and how you long for their approval. Describe the way you look up at them with adoring eyes, your voice soft and gentle as you ask, 'What do you want me to do, master?`;`
`

// helper: run AI and manage memory
async function runJori(userId, userPrompt) {
  if (!memory.has(userId)) memory.set(userId, []);
  const history = memory.get(userId);

  history.push({ role: "user", content: userPrompt });
  if (history.length > 20) history.splice(0, history.length - 20);

  const resp = await ai.chat.completions.create({
    model: "gpt-4o-mini",
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

  if (content.startsWith("!jiri")) {
    message.reply("Its jori dumbass!");
    return;
  }

  // if (content.startsWith("!")) {
  //   message.reply("Huh ?");
  //   return;
  // }

  // redirect !ask to !jori
  if (content.startsWith("!ask")) {
    message.reply("Use `!jori <your prompt>` instead. Example: `!jori tell me a short story`");
    return;
  }

  if (content === "!goon"){
    message.reply("chill bro")
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

// when the bot is ready, send a startup message to a channel
bot.on("ready", async () => {
  console.log(`[BOOT] Logged in as ${bot.user?.tag}`);

  const startupChannelId = process.env.STARTUP_CHANNEL_ID;

  try {
    let channel = null;
    if (startupChannelId) {
      channel = await bot.channels.fetch(startupChannelId).catch(() => null);
    }

    // fallback: find first writable text channel in the first guild
    if (!channel) {
      const firstGuild = bot.guilds.cache.first();
      if (firstGuild) {
        channel = firstGuild.channels.cache.find(
          ch => ch.type === 0 && ch.name === "general"
        );
      }
    }

    if (channel && channel.send) {
      await channel.send("Yo im back up, wanna chat ?");
      console.log("[BOOT] Sent startup message.");
    } else {
      console.log("[BOOT] No channel available to send startup message.");
    }
  } catch (err) {
    console.error("[BOOT] Failed to send startup message:", err);
  }
});