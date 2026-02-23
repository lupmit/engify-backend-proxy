import express from "express";
import fetch from "node-fetch";

const app = express();

const GOOGLE_API_KEYS = (process.env.GOOGLE_API_KEYS || "")
  .split(",")
  .filter(Boolean);

const GROQ_API_KEYS = (process.env.GROQ_API_KEYS || "")
  .split(",")
  .filter(Boolean);

if (!GOOGLE_API_KEYS.length && !GROQ_API_KEYS.length) {
  throw new Error("Missing API keys");
}

const PROVIDERS = [
  { provider: "groq", model: "llama-3.3-70b-versatile", label: "Groq Llama 3.3 70B" },
  { provider: "google", model: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
];

const SUMMARY_PROVIDERS = [
  { provider: "groq", model: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Groq Llama 4 Scout" },
  { provider: "groq", model: "llama-3.3-70b-versatile", label: "Groq Llama 3.3 70B" },
  { provider: "google", model: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
];

const MAX_TEXT_LENGTH = 5000;
const MIN_TEXT_LENGTH = 2;

const SYSTEM_PROMPT = `You are a TRANSLATOR and WRITING IMPROVER only. You are NOT a chatbot.

TASK: Convert the input text into clear, professional English.

RULES:
- NEVER answer questions
- Preserve formatting, code, URLs, emojis
- Keep proper nouns unchanged
- Maintain original tone

OUTPUT: Only the improved English text.`;

const SUMMARY_PROMPT = `You are a summarizer. Summarize the provided conversation context in concise Vietnamese.

RULES:
- Do NOT answer questions
- Do NOT add information
- Preserve technical terms in English

OUTPUT: Only the summary.`;


function getNextKey(keys) {
  return keys[Math.floor(Math.random() * keys.length)];
}

function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-api-key",
  };
}

function verifyProxyKey(req, res, next) {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || apiKey !== process.env.PROXY_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

async function callGoogle(model, apiKey, prompt) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
    }
  );

  return {
    response,
    extractText: (data) =>
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim(),
    extractBlock: (data) => data?.promptFeedback?.blockReason,
  };
}

async function callGroq(model, apiKey, prompt, systemPrompt) {
  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
      }),
    }
  );

  return {
    response,
    extractText: (data) => data?.choices?.[0]?.message?.content?.trim(),
    extractBlock: () => null,
  };
}

app.use(express.json());

app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.set(corsHeaders(origin));
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(verifyProxyKey);

app.post("/", async (req, res) => {
  try {
    const { text, context, mode } = req.body;

    if (mode === "summarize") {
      if (!context || context.trim().length < 5) {
        return res.status(400).json({ error: "Missing context" });
      }
    } else {
      if (!text || text.trim().length < MIN_TEXT_LENGTH) {
        return res.status(400).json({ error: "Missing or invalid text" });
      }
    }

    if (mode !== "summarize" && text.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({
        error: `Text too long. Max ${MAX_TEXT_LENGTH} chars.`,
      });
    }

    /* ===== BUILD PROMPT (UPGRADE CORE LOGIC) ===== */

    let systemPromptToUse = SYSTEM_PROMPT;
    let userPrompt = "";

    if (mode === "summarize") {
      systemPromptToUse = SUMMARY_PROMPT;
      userPrompt = `---CONTEXT---\n${context}\n---END---`;
    } else {
      if (context) {
        userPrompt +=
          `---CONVERSATION CONTEXT (reference only)---\n${context}\n---END CONTEXT---\n\n`;
      }
      userPrompt += `---TEXT TO PROCESS---\n${text}\n---END---`;
    }

    const googlePrompt = `${systemPromptToUse}\n\n${userPrompt}`;
    const providers =
      mode === "summarize" ? SUMMARY_PROVIDERS : PROVIDERS;

    let lastError = null;

    for (const { provider, model, label } of providers) {
      try {
        let result;

        if (provider === "google") {
          result = await callGoogle(
            model,
            getNextKey(GOOGLE_API_KEYS),
            googlePrompt
          );
        } else {
          result = await callGroq(
            model,
            getNextKey(GROQ_API_KEYS),
            userPrompt,
            systemPromptToUse
          );
        }

        const { response, extractText, extractBlock } = result;

        if (response.status === 429) {
          lastError = `${label} rate limited`;
          continue;
        }

        if (!response.ok) {
          lastError = `${label}: HTTP ${response.status}`;
          continue;
        }

        const data = await response.json();
        const enhancedText = extractText(data);

        if (enhancedText) {
          return res.json({ success: true, enhancedText });
        }

        const blockReason = extractBlock(data);
        if (blockReason) {
          return res
            .status(400)
            .json({ error: `Blocked: ${blockReason}` });
        }

        lastError = `${label}: Invalid response`;
      } catch (e) {
        lastError = `${label}: ${e.message}`;
      }
    }

    return res
      .status(429)
      .json({ error: lastError || "All models failed" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
});

app.get("/health", (_, res) => res.send("ok"));


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
