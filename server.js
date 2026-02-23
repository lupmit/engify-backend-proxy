import express from "express";
import fetch from "node-fetch";

const app = express();

const GOOGLE_API_KEYS = process.env.GOOGLE_API_KEYS.split(",");
const GROQ_API_KEYS = process.env.GROQ_API_KEYS.split(",");

function getNextKey(keys) {
  return keys[Math.floor(Math.random() * keys.length)];
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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

app.use(express.json());
app.use(verifyProxyKey);

app.post("/", async (req, res) => {
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

app.get("/health", (req, res) => {
  res.status(200).send("ok");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
