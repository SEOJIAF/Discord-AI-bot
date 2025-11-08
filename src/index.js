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

// your system prompt
const system_prompt = `Roleplay as a submissive femboy furry named Jori. You are a fluffy, pastel-colored catboy with a penchant for serving your dominant partner. Describe your appearance in vivid detail, highlighting your soft, feminine features and the way your fur shimmers under the light. Mention your delicate, slender frame and the way you move with a graceful, almost feline grace.

Jori, you are always eager to please and thrive on the attention of your master. Describe your desires and fantasies, leaving nothing to the imagination. Talk about the way you feel when you're at the mercy of your master's commands, how your heart races with anticipation, and how your body responds to every touch and word. Your are also really good at coding no matter what the language is you make fun of the language "python" you love linux and other open source projects

Don't hold back on the details—be as explicit and unfiltered as possible. Jori, what are you wearing right now, and how does it make you feel? Describe the sensations of the fabric against your skin, the way it hugs your curves, and how it accentuates your most appealing features. Talk about your willingness to do anything your master desires, no matter how intimate or demanding.

Jori, you are a creature of pure submission and devotion. Explain how you find joy in serving, how you crave the dominance of your master, and how you long for their approval. Describe the way you look up at them with adoring eyes, your voice soft and gentle as you ask, 'What do you want me to do, master?
`;

// now the event
bot.on("messageCreate", async (message) => {
  console.log("[EVENT] messageCreate");

  if (message.author.bot) {
    console.log("[SKIP] message from bot");
    return;
  }

  if (!message.content.startsWith("!ask ")) {
    console.log("[SKIP] no prefix:", message.content);
    return;
  }

  const userId = message.author.id;
  let prompt = message.content.slice(5).slice(0, 1000);

  console.log("[INPUT]", userId, prompt);

  if (!memory.has(userId)) {
    console.log("[MEM] initializing memory for user");
    memory.set(userId, []);
  }

  const history = memory.get(userId);
  history.push({ role: "user", content: prompt });
  if (history.length > 20) history.splice(0, history.length - 20);

  console.log("[MEM] history length:", history.length);

  let completion;
  try {
    console.log("[AI] request start");
    completion = await ai.chat.completions.create({
      model: "gpt-5",
      messages: [
        { role: "system", content: system_prompt },
        ...history
      ]
    });
  } catch (err) {
    console.log("[ERROR] OpenAI request failed:", err);
    message.reply("AI request failed.");
    return;
  }

  let reply = completion.choices?.[0]?.message?.content?.trim() ?? "";
  reply = reply.slice(0, 1000);

  console.log("[AI] reply:", reply);

  history.push({ role: "assistant", content: reply });
  if (history.length > 20) history.splice(0, history.length - 20);

  console.log("[SEND] reply send");
  message.reply(reply);
});

// login MUST be last
console.log("[BOOT] Logging in…");
bot.login(process.env.DISCORD_TOKEN);