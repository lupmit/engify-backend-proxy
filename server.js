import express from "express";
import fetch from "node-fetch";

const app = express();

const GOOGLE_API_KEYS = (process.env.GOOGLE_API_KEYS || "").split(",").filter(Boolean);
const GROQ_API_KEYS = (process.env.GROQ_API_KEYS || "").split(",").filter(Boolean);

if (!GOOGLE_API_KEYS.length) {
  throw new Error("Missing GOOGLE_API_KEYS");
}

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
  const apiUrl =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google API error: ${err}`);
  }

  return response.json();
}

app.use(express.json());

app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.set(corsHeaders(origin));
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

app.use(verifyProxyKey);

app.post("/", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: "Missing text" });
    }

    const apiKey = getNextKey(GOOGLE_API_KEYS);
    const data = await callGoogle(
      "gemini-2.5-flash-lite",
      apiKey,
      text
    );

    const enhancedText =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!enhancedText) {
      return res.status(400).json({ error: "No output from model" });
    }

    res.json({ success: true, enhancedText });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/health", (_, res) => {
  res.status(200).send("ok");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
