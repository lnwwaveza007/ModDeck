// The product calls the user's own AI API key (bring your own key). No self-hosted model.
// Each provider: generate(system, user) -> { json, ms, inTokens, outTokens, thinkTokens }

import { SCHEMA } from "./prompt.mjs";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export const PROVIDERS = {
  "gemini-3.5-flash": { kind: "gemini", model: "gemini-3.5-flash" },
  "gemini-3.8-flash": { kind: "gemini", model: "gemini-3.8-flash" },
  // Same model with less thinking. Gemini 3 thinks by default, which adds output tokens.
  "gemini-3.8-flash-low": { kind: "gemini", model: "gemini-3.8-flash", thinkingLevel: "LOW" },
  "gemini-3.1-flash-lite": { kind: "gemini", model: "gemini-3.1-flash-lite" },
};

export function getProvider(name) {
  const p = PROVIDERS[name];
  if (!p) throw new Error(`unknown provider ${name}; try ${Object.keys(PROVIDERS).join(", ")}`);
  return { name, ...p, generate: gemini(p) };
}

function gemini(p) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return async (system, user) => {
    const t0 = performance.now();
    let res;
    for (let attempt = 0; ; attempt++) {
      res = await fetch(`${GEMINI_URL}/${p.model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseJsonSchema: SCHEMA,
            temperature: 0.4,
            ...(p.thinkingLevel && { thinkingConfig: { thinkingLevel: p.thinkingLevel } }),
          },
        }),
      });
      if (res.ok || attempt >= 4 || ![429, 500, 503].includes(res.status)) break;
      // A daily quota does not reset in seconds, and each retry uses up another request.
      if (res.status === 429 && /PerDay/.test(await res.clone().text())) break;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
    if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 600)}`);
    const body = await res.json();
    const ms = performance.now() - t0;
    const text =
      body.candidates?.[0]?.content?.parts
        ?.filter((x) => !x.thought)
        .map((x) => x.text)
        .join("") ?? "";
    const u = body.usageMetadata ?? {};
    return {
      json: JSON.parse(text),
      ms,
      modelVersion: body.modelVersion,
      inTokens: u.promptTokenCount ?? 0,
      outTokens: u.candidatesTokenCount ?? 0,
      thinkTokens: u.thoughtsTokenCount ?? 0,
    };
  };
}
