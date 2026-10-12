// Embedding models under test. Each model gets the same interface:
//   embedQueries(texts) / embedDocs(docs) -> number[][] (unit length)
// Questions use the query side only, for both slide lookup and clustering,
// because the product embeds each question once.

import { pipeline } from "@huggingface/transformers";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export const MODELS = {
  "e5-small": {
    kind: "local",
    hf: "Xenova/multilingual-e5-small",
    dims: 384,
    params: "118M",
    pooling: "mean",
    query: (q) => `query: ${q}`,
    doc: (d) => `passage: ${d.title}\n${d.text}`,
  },
  "e5-base": {
    kind: "local",
    hf: "Xenova/multilingual-e5-base",
    dims: 768,
    params: "278M",
    pooling: "mean",
    query: (q) => `query: ${q}`,
    doc: (d) => `passage: ${d.title}\n${d.text}`,
  },
  "bge-m3": {
    kind: "local",
    hf: "Xenova/bge-m3",
    dims: 1024,
    params: "568M",
    pooling: "cls",
    query: (q) => q,
    doc: (d) => `${d.title}\n${d.text}`,
  },
  // Same model, 8-bit weights: about 4x smaller download, faster on CPU.
  "bge-m3-q8": {
    kind: "local",
    hf: "Xenova/bge-m3",
    dtype: "q8",
    dims: 1024,
    params: "568M",
    pooling: "cls",
    query: (q) => q,
    doc: (d) => `${d.title}\n${d.text}`,
  },
  "gemini-2": {
    kind: "api",
    api: "gemini-embedding-2",
    dims: 768,
    query: (q) => `task: question answering | query: ${q}`,
    doc: (d) => `title: ${d.title} | text: ${d.text}`,
  },
  "gemini-001": {
    kind: "api",
    api: "gemini-embedding-001",
    dims: 768,
    taskQuery: "RETRIEVAL_QUERY",
    taskDoc: "RETRIEVAL_DOCUMENT",
    query: (q) => q,
    doc: (d) => `${d.title}\n${d.text}`,
  },
};

export const normalize = (v) => {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};

export async function loadModel(name) {
  const m = MODELS[name];
  if (!m) throw new Error(`unknown model ${name}; try ${Object.keys(MODELS).join(", ")}`);
  return m.kind === "local" ? loadLocal(name, m) : loadGemini(name, m);
}

async function loadLocal(name, m) {
  const device = process.env.EMBED_DEVICE || "cpu";
  const dtype = m.dtype || process.env.EMBED_DTYPE || "fp32";
  const t0 = performance.now();
  const extractor = await pipeline("feature-extraction", m.hf, { device, dtype });
  const loadMs = performance.now() - t0;
  const run = async (texts) => {
    const out = [];
    // Small batches keep padding (and memory) down on long slides.
    for (let i = 0; i < texts.length; i += 8) {
      const t = await extractor(texts.slice(i, i + 8), { pooling: m.pooling, normalize: true });
      out.push(...t.tolist());
    }
    return out;
  };
  const countTokens = (texts) =>
    texts.reduce((n, t) => n + extractor.tokenizer.encode(t).length, 0);
  return {
    name,
    ...m,
    device,
    dtype,
    loadMs,
    embedQueries: (qs) => run(qs.map(m.query)),
    embedDocs: (ds) => run(ds.map(m.doc)),
    countTokens,
  };
}

async function loadGemini(name, m) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set (put it in the repo .env)");
  // The title slide of a deck holds the lecturer's email and phone number.
  // They add nothing to the embedding, so they are not sent to the API.
  const redact = (t) =>
    t.replace(/[w.+-]+@[w-]+(.[w-]+)+/g, "[email]").replace(/d{2,3}[-s]?d{3}[-s]?d{4}/g, "[phone]");
  // One embedContent request per text. batchEmbedContents hits the free-tier
  // quota at once, because a batch of 100 counts as 100 requests.
  const one = async (text, taskType) => {
    const res = await fetchRetry(`${GEMINI_URL}/${m.api}:embedContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        model: `models/${m.api}`,
        content: { parts: [{ text: redact(text) }] },
        outputDimensionality: m.dims,
        ...(taskType && { taskType }),
      }),
    });
    // gemini-embedding-001 is unit length only at 3072 dims.
    return normalize((await res.json()).embedding.values);
  };
  const CONCURRENCY = Number(process.env.GEMINI_CONCURRENCY || 4);
  const call = async (texts, taskType) => {
    const out = new Array(texts.length);
    let next = 0;
    const worker = async () => {
      while (next < texts.length) {
        const i = next++;
        out[i] = await one(texts[i], taskType);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, texts.length) }, worker));
    return out;
  };
  const countTokens = async (texts) => {
    let n = 0;
    for (let i = 0; i < texts.length; i += 50) {
      const res = await fetchRetry(`${GEMINI_URL}/${m.api}:countTokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: texts.slice(i, i + 50).map((t) => ({ parts: [{ text: t }] })),
        }),
      }).catch(() => null);
      if (!res) return null;
      n += (await res.json()).totalTokens;
    }
    return n;
  };
  return {
    name,
    ...m,
    device: "api",
    loadMs: 0,
    embedQueries: (qs) => call(qs.map(m.query), m.taskQuery),
    embedDocs: (ds) => call(ds.map(m.doc), m.taskDoc),
    countTokens,
  };
}

async function fetchRetry(url, init, tries = 8) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, init);
    if (res.ok) return res;
    const body = await res.text();
    // Free tier rate limits: wait and retry.
    if ((res.status === 429 || res.status >= 500) && i < tries - 1) {
      const hinted = Number((body.match(/"retryDelay":s*"(d+(?:.d+)?)s"/) || [])[1]);
      const wait = hinted ? hinted * 1000 + 500 : Math.min(30000, 2000 * 2 ** i);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw new Error(`${res.status} ${url.split("/").pop()}: ${body.slice(0, 300)}`);
  }
}
