// Local server for the question board demo.
//   node demo/server.mjs          then open http://localhost:4173
//
// Serves demo/index.html and answers questions typed on the page: it embeds
// the text with bge-m3 (8-bit, on this computer) and compares it with the
// stored slide and question vectors in out/emb-bge-m3-q8.json. Nothing leaves
// this machine. It listens on 127.0.0.1 only and has no dependencies besides
// the spike's own packages.
//
// Needs: node src/embed.mjs bge-m3-q8   (creates the vectors)
//        node src/build-demo.mjs        (creates demo/index.html)

import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { loadData } from "../src/data.mjs";
import { loadModel } from "../src/models.mjs";

const PORT = Number(process.env.PORT || 4173);
const HOST = "127.0.0.1";
const MODEL = "bge-m3-q8";
const INDEX = new URL("index.html", import.meta.url);
const VECTORS = new URL(`../out/emb-${MODEL}.json`, import.meta.url);
const IMAGES = new URL("../../md-14-pdf-import/out/images/", import.meta.url);
const MAX_BODY = 8 * 1024;
const MAX_CUSTOM = 500;

const DECK_SLUG = {
  vue: "chapter1-introductiontovue",
  w07: "int319-w07-development-of-corporate-strategy-and-plan-ii-workshop-g1",
};

if (!existsSync(VECTORS)) {
  console.error(`Missing ${VECTORS.pathname}\nRun first: node src/embed.mjs ${MODEL}`);
  process.exit(1);
}

const emb = JSON.parse(readFileSync(VECTORS, "utf8"));
const { questions } = loadData();
const deckOf = new Map(questions.map((q) => [q.id, q.deck]));
const qvec = new Map(emb.questions.map((q) => [q.id, q.vec]));
const slidesByDeck = {};
for (const s of emb.slides) (slidesByDeck[s.deck] ||= []).push(s);

const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

// Model loads in the background so the page can show progress.
let model = null;
let loadError = null;
let chain = Promise.resolve(); // one embedding at a time
const t0 = performance.now();
loadModel(MODEL)
  .then(async (m) => {
    await m.embedQueries(["warm-up"]);
    model = m;
    console.log(`Model ready in ${((performance.now() - t0) / 1000).toFixed(1)} s (${m.device})`);
  })
  .catch((e) => {
    loadError = e.message;
    console.error("Model failed to load:", e.message);
  });

const customs = new Map(); // id -> { deck, vec }
let counter = 0;

const send = (res, status, body, type = "application/json; charset=utf-8") => {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

async function ask({ deck, text, previous }) {
  const start = performance.now();
  const [vec] = await (chain = chain.then(() => model.embedQueries([text])));
  const embedMs = performance.now() - start;

  const s0 = performance.now();
  const sims = {};
  for (const [id, v] of qvec) if (deckOf.get(id) === deck) sims[id] = +dot(vec, v).toFixed(4);
  const slides = slidesByDeck[deck]
    .map((s) => ({ page: s.page, sim: dot(vec, s.vec) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 3)
    .map((r) => ({ page: r.page, sim: +r.sim.toFixed(3) }));
  const customSims = {};
  for (const id of previous) {
    const c = customs.get(id);
    if (c && c.deck === deck) customSims[id] = +dot(vec, c.vec).toFixed(4);
  }
  const searchMs = performance.now() - s0;

  const id = `you-${++counter}`;
  customs.set(id, { deck, vec });
  if (customs.size > MAX_CUSTOM) customs.delete(customs.keys().next().value);
  return { id, sims, customSims, slides, ms: { embed: embedMs, search: searchMs } };
}

const server = createServer((req, res) => {
  // Refuse requests whose Host header is not ours (DNS rebinding) and
  // cross-site browser requests.
  const host = req.headers.host || "";
  if (host !== `localhost:${PORT}` && host !== `127.0.0.1:${PORT}`)
    return send(res, 403, { error: "bad host" });
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) return send(res, 403, { error: "bad origin" });

  const { pathname } = new URL(req.url, `http://${host}`);

  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    if (!existsSync(INDEX)) {
      return send(
        res,
        404,
        "demo/index.html is missing. Run: node src/build-demo.mjs",
        "text/plain; charset=utf-8",
      );
    }
    return send(res, 200, readFileSync(INDEX, "utf8"), "text/html; charset=utf-8");
  }

  if (req.method === "GET" && pathname === "/api/status") {
    return send(res, 200, { ready: Boolean(model), error: loadError, model: MODEL });
  }

  // Slide image from the MD-14 import output: /slides/<deck>/<page>
  const img = pathname.match(/^\/slides\/(vue|w07)\/(\d{1,3})$/);
  if (req.method === "GET" && img) {
    const file = new URL(`${DECK_SLUG[img[1]]}/${img[2].padStart(3, "0")}.webp`, IMAGES);
    if (!existsSync(file)) return send(res, 404, { error: "no image" });
    res.writeHead(200, { "Content-Type": "image/webp", "Cache-Control": "max-age=3600" });
    return res.end(readFileSync(file));
  }

  if (req.method === "POST" && pathname === "/api/ask") {
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) {
      return send(res, 415, { error: "content-type must be application/json" });
    }
    if (!model) return send(res, 503, { error: loadError || "the model is still loading" });
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        send(res, 413, { error: "too large" });
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", async () => {
      if (res.writableEnded) return;
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return send(res, 400, { error: "invalid JSON" });
      }
      const text = typeof body?.text === "string" ? body.text.trim().slice(0, 300) : "";
      const deck = body?.deck;
      const previous = Array.isArray(body?.previous)
        ? body.previous.filter((x) => typeof x === "string").slice(0, 100)
        : [];
      if (!text) return send(res, 400, { error: "the question is empty" });
      if (!slidesByDeck[deck]) return send(res, 400, { error: "unknown deck" });
      try {
        send(res, 200, await ask({ deck, text, previous }));
      } catch (e) {
        send(res, 500, { error: e.message });
      }
    });
    return;
  }

  send(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`Question board: http://localhost:${PORT}`);
  console.log(`Loading ${MODEL}… the page enables the Ask button when it is ready.`);
});
