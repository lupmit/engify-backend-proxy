import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const GOOGLE_API_KEYS = process.env.GOOGLE_API_KEYS.split(",");
const GROQ_API_KEYS = process.env.GROQ_API_KEYS.split(",");

function getNextKey(keys) {
  return keys[Math.floor(Math.random() * keys.length)];
}

function isAllowedOrigin(origin) {
  return origin && origin.startsWith("chrome-extension://");
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

async function callGoogle(model, apiKey, prompt) {
  const apiUrl =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  return response;
}

async function callGroq(model, apiKey, prompt, systemPrompt) {
  return fetch("https://api.groq.com/openai/v1/chat/completions", {
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
  });
}

app.options("*", (req, res) => {
  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin)) return res.sendStatus(403);
  res.set(corsHeaders(origin)).send();
});

app.post("/", async (req, res) => {
  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const { text, context, mode } = req.body;

    // (giữ nguyên validation + prompt logic của bạn)

    // ví dụ gọi Google
    const apiKey = getNextKey(GOOGLE_API_KEYS);
    const response = await callGoogle(
      "gemini-2.5-flash-lite",
      apiKey,
      text
    );

    const data = await response.json();
    const enhancedText =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!enhancedText) {
      return res.status(400).json({ error: "No output" });
    }

    res.set(corsHeaders(origin)).json({ success: true, enhancedText });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
