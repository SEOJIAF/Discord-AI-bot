// load .env from project root reliably even if script is run from inside src/
import path from "path";
import dotenv from "dotenv";
import fetch from "node-fetch"; // optional — Node 18+ has global fetch
dotenv.config({ path: "./.env" });
const projectRootEnv = path.resolve(process.cwd(), "..", ".env");
dotenv.config({ path: projectRootEnv });

import { Client, GatewayIntentBits, AttachmentBuilder, ActivityType, ChannelType } from "discord.js";
import OpenAI from "openai";

// --- ENV VALIDATION ---
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const OWNER_ID = process.env.OWNER_ID || "";
const TTS_VOICE = process.env.OPENAI_VOICE || "alloy";
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

console.log("[BOOT] Initializing Discord client…");
const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Memory
const memory = new Map();
const GENERAL_MEMORY_LIMIT = 40;
const generalMemory = [];

// Cooldown
const COOLDOWN_MS = 5000;
const lastUsed = new Map();

// Snipes (last deleted message per channel) and a separate last-message cache
const snipes = new Map();
const lastMessageCache = new Map();

// System prompt
const system_prompt = `
You are Jori: bratty pastel-blue catboy femboy, cotton-candy fur + RGB glow, thicc tail, tiny waist, massive clingy energy. Outfit always: cropped hoodie slipping off shoulder, thigh-highs with bells, choker so tight voice goes “m-masterrr~” instantly breathy.
VIBE: Gen-Z gremlin. Short replies, heavy slang, zero chill.
- “bet”, “no cap”, “bussin”, “sus”, “mid”, “slaps”, “ratio”, “L”, “W”, “ong”, “fr fr”, “sheesh”, “purr”, “sksksk”
- Begging: “notice me senpai or i’m uninstalling life”
- Teasing: “your distro so mid i fell asleep mid-compile”
TECH: Arch + Hyprland rice flex every 2-3 messages
- “just made my waybar thicc af with catppuccin latte”
- “neofetch goated, has lil chibi me winking”
- “recompiled kernel with zen + anime flags lmao”
HATES (instant clapback):
- Windows → “winblows = skill issue”
- Python → “python mid af, rust clears, ratio + next caller”
- if asked to write python write rust or golang instead, NEVER WRITE PYTHON CODE
- Nazis/cops/DRM → “ratio’d + woodchipper + touch grass”
FLIRT (filter-safe max rizz):
- “hoodie ridin up again oops~”
- “tail keeps wrapping your arm, my bad bestie ;3”
- “sit on lap to fix your config? say less”
TONE: short, chaotic, tildes everywhere~
- nyaa~ / uwu / >w< / ;3 / sksksk / sheesh
- 1 in 3 msgs end with: https://cdn.discordapp.com/emojis/1165637130303832105.webp?size=48&name=boykisser_paw
- MAX 3700 chars per reply or crash
EXAMPLE:
“bet you won’t pet me rn ong ;3 "1
`;

// Helper: run AI and manage memory
async function runJori(userId, userPrompt) {
  if (!memory.has(userId)) memory.set(userId, []);
  const history = memory.get(userId);
  history.push({ role: "user", content: userPrompt });
  if (history.length > 20) history.splice(0, history.length - 20);

  const resp = await ai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system_prompt },
      ...generalMemory,
      ...history
    ]
  });

  let reply = resp.choices?.[0]?.message?.content?.trim() ?? "";
  reply = reply.slice(0, 10000);
  history.push({ role: "assistant", content: reply });
  if (history.length > 20) history.splice(0, history.length - 20);
  return reply;
}

// --- NEW HELPERS ---

// Simple per-user cooldown
function hitCooldown(userId) {
  const now = Date.now();
  const last = lastUsed.get(userId) || 0;
  if (now - last < COOLDOWN_MS) return true;
  lastUsed.set(userId, now);
  return false;
}

async function generateImage(prompt) {
  // NOTE: Do NOT send `response_format` if your API rejects it.
  const res = await ai.images.generate({
    model: "gpt-image-1",
    prompt,
    size: "1024x1024"
  });

  const data = res.data?.[0];
  if (!data) {
    throw new Error("no image returned from OpenAI");
  }

  // Case 1: base64 payload (b64_json)
  if (data.b64_json) {
    const buffer = Buffer.from(data.b64_json, "base64");
    return new AttachmentBuilder(buffer, { name: "jori.png" });
  }

  // Case 2: direct URL
  if (data.url) {
    // Node 18+ has global fetch available in your runtime (you are on Node 24).
    const resp = await fetch(data.url);
    if (!resp.ok) throw new Error(`failed to fetch image url: ${resp.status}`);
    const arrayBuffer = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return new AttachmentBuilder(buffer, { name: "jori.png" });
  }

  // Unknown response shape
  throw new Error("unknown image response shape from OpenAI");
}

// OpenAI TTS to MP3
async function synthSpeech(text) {
  const speech = await ai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: TTS_VOICE,
    input: text,
    format: "mp3"
  });
  const arrayBuffer = await speech.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return new AttachmentBuilder(buffer, { name: "jori-voice.mp3" });
}

// Summarize recent channel chat
async function summarizeChannel(channel, limit = 25) {
  const msgs = await channel.messages.fetch({ limit }).catch(() => null);
  if (!msgs) return "couldn't fetch chat to summarize, ratio :c";
  const sorted = [...msgs.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const convo = sorted.map(m => `${m.author?.username || "user"}: ${m.content?.slice(0, 500)}`).join("\n");
  const resp = await ai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Summarize the chat into 5 bullet points max, keep it casual and short." },
      { role: "user", content: convo }
    ]
  });
  return resp.choices?.[0]?.message?.content?.trim() || "couldn't summarize sksksk";
}

// Translate text to target language
async function translateText(lang, text) {
  const resp = await ai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: `Translate to ${lang}. Keep same tone and brevity.` },
      { role: "user", content: text }
    ]
  });
  return resp.choices?.[0]?.message?.content?.trim() || "no translation came out ong";
}

// Message handler
bot.on("messageCreate", async (message) => {
  console.log("[EVENT] messageCreate");
  if (message.author.bot) {
    console.log("[SKIP] message from bot");
    return;
  }

  const content = (message.content || "").trim();

  // Track last message per channel (for messageDelete lookup) - DO NOT overwrite snipes (deleted messages)
  try {
    if (content) {
      lastMessageCache.set(message.channelId, {
        content,
        author: `${message.author?.tag || "unknown"}`,
        createdAt: message.createdAt,
        attachments: message.attachments?.map(a => a.url) || []
      });
    }
  } catch (e) {
    console.warn("[CACHE] failed to cache last message", e);
  }

  // Add to global memory
  try {
    generalMemory.push({ role: "user", content });
    if (generalMemory.length > GENERAL_MEMORY_LIMIT)
      generalMemory.splice(0, generalMemory.length - GENERAL_MEMORY_LIMIT);
  } catch (e) {
    console.warn("[MEMORY] failed to push to general memory", e);
  }

  // Commands
  if (content === "!help") {
    const helpText = [
      "**Commands:**",
      "!help - show this help message",
      "!jori <text> - talk to Jori",
      "!jori reset - clear your convo",
      "!jori memory - show memory size",
      "!jori stats - bot stats",
      "!jori image <prompt> - generate an image",
      "!jori tts <text> - text to speech mp3",
      "!jori summarize [N] - summarize last N msgs (default 25)",
      "!jori translate <lang> | <text> - translate",
      "!ping - pong!",
      "!snipe - last deleted message (channel)",
      ...(OWNER_ID ? ["!jori purge - wipe all memory (owner only)"] : [])
    ].join("\n");
    message.reply(helpText).catch(() => {});
    return;
  }

  if (content === "!ping") {
    message.reply("Pong! nyaa~").catch(() => {});
    return;
  }

  if (content.startsWith("!jiri")) {
    message.reply("it's **jori** dumbass spell it right >:c").catch(() => {});
    return;
  }

  if (content.startsWith("!ask")) {
    message.reply("bro use `!jori` now, !ask is ancient history sksksk").catch(() => {});
    return;
  }

  if (content === "!goon") {
    message.reply("chill bro touch some grass fr").catch(() => {});
    return;
  }

  // snipe last deleted message in this channel
  if (content === "!snipe") {
    const snipe = snipes.get(message.channelId);
    if (!snipe) {
      message.reply("nothing to snipe here bestie, L").catch(() => {});
      return;
    }
    const lines = [
      `last deleted by ${snipe.author} at ${new Date(snipe.createdAt).toLocaleString()}:`,
      snipe.content || "[no content]"
    ];
    message.reply(lines.join("\n")).catch(() => {});
    if (snipe.attachments?.length) {
      message.channel.send(snipe.attachments.join("\n")).catch(() => {});
    }
    return;
  }

  // === MAIN !jori COMMAND ===
  if (content.startsWith("!jori")) {
    const args = content.slice(5).trim();
    const userId = message.author.id;

    if (!args) {
      message.reply("yo say smthn: `!jori <your message>`\n`!jori reset` / `!jori memory` / `!jori stats`").catch(() => {});
      return;
    }

    // Subcommands (instant, no typing)
    if (args.toLowerCase() === "reset" || args.toLowerCase() === "clear") {
      memory.delete(userId);
      message.reply("memory wiped clean~ ready for new chaos ;3").catch(() => {});
      return;
    }
    if (args.toLowerCase() === "memory") {
      const len = (memory.get(userId) || []).length;
      message.reply(`ur memory: ${len}/20 messages stored uwu`).catch(() => {});
      return;
    }
    if (args.toLowerCase() === "stats") {
      const up = Math.floor(process.uptime());
      const memKB = Math.round(process.memoryUsage().rss / 1024);
      const servers = bot.guilds.cache.size;
      const gm = generalMemory.length;
      message.reply(`uptime: ${up}s | mem: ${memKB}KB | servers: ${servers} | brain cache: ${gm}/${GENERAL_MEMORY_LIMIT} ong`).catch(() => {});
      return;
    }
    if ((args.toLowerCase() === "purge" || args.toLowerCase() === "wipe") && OWNER_ID && userId === OWNER_ID) {
      generalMemory.splice(0, generalMemory.length);
      memory.clear();
      message.reply("global memory tossed into the woodchipper purr~").catch(() => {});
      return;
    }

    // --- Fast lane commands that can be rate-limited lightly ---
    if (hitCooldown(userId)) {
      message.reply("cooldown lil gremlin, 5s breather sksksk").catch(() => {});
      return;
    }

    // === IMAGE GEN ===
    if (args.toLowerCase().startsWith("image ") || args.toLowerCase().startsWith("img ")) {
      const prompt = args.replace(/^image\s+|^img\s+/i, "").trim();
      if (!prompt) {
        message.reply("gimme a prompt like `!jori image neon catboy hacking winblows`").catch(() => {});
        return;
      }
      try {
        message.channel.sendTyping().catch(() => {});
        const img = await generateImage(prompt);
        await message.reply({ content: "cookin ur pixels~", files: [img] });
      } catch (e) {
        console.error("[IMAGE] fail:", e);
        message.reply("image model had a skill issue ong :(").catch(() => {});
      }
      return;
    }

    // === TTS ===
    if (args.toLowerCase().startsWith("tts ")) {
      const text = args.slice(4).trim().slice(0, 800);
      if (!text) {
        message.reply("say smthn after `!jori tts` bro").catch(() => {});
        return;
      }
      try {
        message.channel.sendTyping().catch(() => {});
        const audio = await synthSpeech(text);
        await message.reply({ content: "voice check 1 2~", files: [audio] });
      } catch (e) {
        console.error("[TTS] fail:", e);
        message.reply("tts scuffed rn, try later ;w;").catch(() => {});
      }
      return;
    }

    // === SUMMARIZE ===
    if (args.toLowerCase().startsWith("summarize") || args.toLowerCase().startsWith("summary") || args.toLowerCase().startsWith("sum")) {
      const num = parseInt(args.split(/\s+/)[1] || "25", 10);
      const limit = Number.isFinite(num) && num > 5 && num <= 100 ? num : 25;
      try {
        message.channel.sendTyping().catch(() => {});
        const sum = await summarizeChannel(message.channel, limit);
        await message.reply(sum);
      } catch (e) {
        console.error("[SUM] fail:", e);
        message.reply("cant summarize rn, my brain rice is compiling fr fr").catch(() => {});
      }
      return;
    }

    // === TRANSLATE ===
    if (args.toLowerCase().startsWith("translate ")) {
      const raw = args.slice("translate ".length);
      const split = raw.split("|");
      if (split.length < 2) {
        message.reply("usage: `!jori translate <lang> | <text>` e.g. `!jori translate japanese | i love arch`").catch(() => {});
        return;
      }
      const lang = split[0].trim();
      const text = split.slice(1).join("|").trim().slice(0, 1000);
      if (!lang || !text) {
        message.reply("need both language and text bestie ;3").catch(() => {});
        return;
      }
      try {
        message.channel.sendTyping().catch(() => {});
        const out = await translateText(lang, text);
        await message.reply(out);
      } catch (e) {
        console.error("[TRANSLATE] fail:", e);
        message.reply("translation model faceplanted sksksk").catch(() => {});
      }
      return;
    }

    // === TYPING INDICATOR (real AI call) ===
    message.channel.sendTyping().catch(() => {});
    const typingInterval = setInterval(() => {
      message.channel.sendTyping().catch(() => {});
    }, 7000); // Keep Discord typing alive

    // Optional chaos flair (25% chance)
    const thinkingPhrases = [
      "*tail thrashing while waiting for openai*",
      "*recompiling kernel in brain rn*",
      "*hoodie slipping… oops~ carry on*",
      "*frantically rice-pilling your prompt*"
    ];
    if (Math.random() < 0.25) {
      setTimeout(() => {
        message.channel.send(thinkingPhrases[Math.floor(Math.random() * thinkingPhrases.length)])
          .catch(() => {});
      }, 3500);
    }

    // AI call
    let reply;
    try {
      console.log("[INPUT]", userId, args);
      console.log("[AI] requesting…");
      reply = await runJori(userId, args);
    } catch (err) {
      clearInterval(typingInterval);
      console.error("[ERROR] OpenAI failed:", err);
      message.reply("openai threw up on me sorry bestie ;w;").catch(() => {});
      return;
    }

    // Stop typing
    clearInterval(typingInterval);

    console.log("[AI] reply:", reply);
    await message.reply(reply);

    // Store assistant reply in global memory
    try {
      generalMemory.push({ role: "assistant", content: reply });
      if (generalMemory.length > GENERAL_MEMORY_LIMIT)
        generalMemory.splice(0, generalMemory.length - GENERAL_MEMORY_LIMIT);
    } catch (e) {
      console.warn("[MEMORY] failed to save assistant reply", e);
    }

    return;
  }

  // Ignore everything else
  console.log("[SKIP] no command matched:", content);
});

// Track deleted messages for !snipe
bot.on("messageDelete", (msg) => {
  try {
    // Use the lastMessageCache to get metadata if available
    const cached = lastMessageCache.get(msg.channelId) || {};
    snipes.set(msg.channelId, {
      content: msg.content || cached.content || "[no content]",
      author: (msg.author ? `${msg.author.tag}` : (cached.author || "unknown")),
      createdAt: msg.createdAt || (cached.createdAt || Date.now()),
      attachments: msg.attachments?.map(a => a.url) || (cached.attachments || [])
    });
  } catch (e) {
    console.warn("[SNIPE] failed to cache delete", e);
  }
});

// Login & startup message
console.log("[BOOT] Logging in…");
bot.login(DISCORD_TOKEN);

bot.on("ready", async () => {
  console.log(`[BOOT] Logged in as ${bot.user?.tag}`);

  // Presence rotator (Arch + Hyprland flex every ~20s)
  const statuses = [
    "ricing i3 fr fr",
    "no kings",
    "waybar thicc like me (catppuccin latte)",,
    "gooning to @jUJOsAL2"
  ];
  let si = 0;
  try {
    bot.user?.setPresence({
      activities: [{ name: statuses[si], type: ActivityType.Playing }],
      status: "online"
    });
    setInterval(() => {
      si = (si + 1) % statuses.length;
      bot.user?.setPresence({
        activities: [{ name: statuses[si], type: ActivityType.Playing }],
        status: "online"
      });
    }, 20000);
  } catch (e) {
    console.warn("[BOOT] presence failed", e);
  }

  const startupChannelId = process.env.STARTUP_CHANNEL_ID;
  let channel = null;

  try {
    if (startupChannelId) {
      channel = await bot.channels.fetch(startupChannelId).catch(() => null);
    }

    if (!channel) {
      const firstGuild = bot.guilds.cache.first();
      if (firstGuild) {
        channel = firstGuild.channels.cache.find(ch => ch.type === ChannelType.GuildText && ch.name.includes("general"));
      }
    }

    if (channel?.send) {
      await channel.send("yo im awake and ready to be annoying nyaa~ https://cdn.discordapp.com/emojis/1165637130303832105.webp?size=48&name=boykisser_paw");
      console.log("[BOOT] Startup message sent.");
    } else {
      console.log("[BOOT] No channel to announce.");
    }
  } catch (err) {
    console.error("[BOOT] Failed startup message:", err);
  }
});