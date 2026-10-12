// Latency per question: embed one question + pgvector top-3 slides + nearest
// earlier question. This is the work done when a student sends a question.
//   node src/latency.mjs e5-small gemini-2
// Run embed.mjs first so the tables exist.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadData } from "./data.mjs";
import { loadModel } from "./models.mjs";
import { connect, nearestQuestion, topSlides } from "./db.mjs";

process.loadEnvFile?.(new URL("../../../.env", import.meta.url));
const { questions } = loadData();
const db = await connect();
const BURST = 50;

const pctl = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const stats = (xs) => ({ p50: pctl(xs, 50), p95: pctl(xs, 95), max: Math.max(...xs) });

const file = new URL("../out/latency.json", import.meta.url);
const out = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};

for (const name of process.argv.slice(2)) {
  const m = await loadModel(name);
  for (const q of questions.slice(0, 5)) await m.embedQueries([q.text]); // warm up

  // 1. One question at a time.
  const embed = [],
    search = [],
    total = [];
  for (const q of questions) {
    const t0 = performance.now();
    const [v] = await m.embedQueries([q.text]);
    const t1 = performance.now();
    await topSlides(db, name, q.deck, v, 3);
    await nearestQuestion(db, name, q.deck, v, q.id);
    const t2 = performance.now();
    embed.push(t1 - t0);
    search.push(t2 - t1);
    total.push(t2 - t0);
  }

  // 2. Burst: BURST questions arrive at the same moment (end of a lecture
  // segment). Each is sent on its own, not batched.
  const burstQs = Array.from({ length: BURST }, (_, i) => questions[i % questions.length]);
  const t0 = performance.now();
  const each = await Promise.all(
    burstQs.map(async (q) => {
      const s = performance.now();
      const [v] = await m.embedQueries([q.text]);
      await topSlides(db, name, q.deck, v, 3);
      return performance.now() - s;
    }),
  );
  const burstWall = performance.now() - t0;

  out[name] = {
    device: m.device,
    embed: stats(embed),
    search: stats(search),
    total: stats(total),
    burst: {
      n: BURST,
      wallMs: burstWall,
      perQuestion: stats(each),
      qps: BURST / (burstWall / 1000),
    },
  };
  const f = (x) => x.toFixed(0).padStart(5);
  const o = out[name];
  console.log(
    `${name.padEnd(10)} embed p50 ${f(o.embed.p50)} p95 ${f(o.embed.p95)} | search p50 ${o.search.p50.toFixed(1)} p95 ${o.search.p95.toFixed(1)} | ` +
      `total p50 ${f(o.total.p50)} p95 ${f(o.total.p95)} ms | burst ${BURST}: ${f(burstWall)} ms wall, p95 ${f(o.burst.perQuestion.p95)} ms, ${o.burst.qps.toFixed(1)} q/s`,
  );
}

writeFileSync(file, JSON.stringify(out, null, 1));
await db.end();
