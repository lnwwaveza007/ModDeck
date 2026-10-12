// Score each embedded model against the labels.
//   node src/evaluate.mjs e5-small e5-base bge-m3 gemini-2
// Slide lookup goes through pgvector when it is up, else brute force in JS.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadData } from "./data.mjs";
import { connect, topSlides } from "./db.mjs";

const { questions } = loadData();
const byId = new Map(questions.map((q) => [q.id, q]));
const DECKS = ["vue", "w07"];
const ORDERS = 20; // random arrival orders per deck, metrics are averaged
const THRESHOLDS = Array.from({ length: 70 }, (_, i) => +(0.3 + i * 0.01).toFixed(2));

const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

function rng(seed) {
  return () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
}
function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Online clustering, one question at a time, as it would run in class.
// single:   join the cluster of the most similar earlier question.
// centroid: join the cluster whose mean vector is most similar.
function cluster(items, t, mode) {
  const label = new Map();
  const clusters = []; // { sum, members }
  for (const it of items) {
    let best = -1;
    let bestSim = -Infinity;
    if (mode === "single") {
      for (const prev of label.keys()) {
        const s = dot(it.vec, vecOf.get(prev));
        if (s > bestSim) [bestSim, best] = [s, label.get(prev)];
      }
    } else {
      clusters.forEach((c, ci) => {
        const s = dot(it.vec, c.sum) / Math.hypot(...c.sum);
        if (s > bestSim) [bestSim, best] = [s, ci];
      });
    }
    if (best >= 0 && bestSim >= t) {
      label.set(it.id, best);
      clusters[best].sum = clusters[best].sum.map((x, i) => x + it.vec[i]);
      clusters[best].members.push(it.id);
    } else {
      label.set(it.id, clusters.length);
      clusters.push({ sum: [...it.vec], members: [it.id] });
    }
  }
  return clusters.map((c) => c.members);
}
let vecOf;

function pairScores(clusters, ids) {
  const pred = new Map();
  clusters.forEach((c, i) => c.forEach((id) => pred.set(id, i)));
  let tp = 0,
    fp = 0,
    fn = 0,
    xTp = 0,
    xGold = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = byId.get(ids[i]),
        b = byId.get(ids[j]);
      const gold = a.group === b.group;
      const same = pred.get(a.id) === pred.get(b.id);
      if (gold && same) tp++;
      else if (same) fp++;
      else if (gold) fn++;
      // Cross-language pairs: one English question, one Thai or mixed.
      if (gold && (a.lang === "en") !== (b.lang === "en")) {
        xGold++;
        if (same) xTp++;
      }
    }
  }
  // Wrong cards: predicted clusters that mix two or more labelled groups.
  const mixed = clusters.filter((c) => new Set(c.map((id) => byId.get(id).group)).size > 1).length;
  return { tp, fp, fn, xTp, xGold, mixed, clusters: clusters.length };
}

function clusteringFor(emb, decks, t, mode) {
  const sum = { tp: 0, fp: 0, fn: 0, xTp: 0, xGold: 0, mixed: 0, clusters: 0 };
  for (const deck of decks) {
    const items = emb.questions.filter((q) => byId.get(q.id).deck === deck);
    for (let o = 0; o < ORDERS; o++) {
      const order = shuffle(items, rng(1000 * o + deck.length));
      const s = pairScores(
        cluster(order, t, mode),
        items.map((q) => q.id),
      );
      for (const k in sum) sum[k] += s[k] / ORDERS;
    }
  }
  const precision = sum.tp + sum.fp ? sum.tp / (sum.tp + sum.fp) : 1;
  const recall = sum.tp / (sum.tp + sum.fn);
  const f = (beta) =>
    precision + recall
      ? ((1 + beta ** 2) * precision * recall) / (beta ** 2 * precision + recall)
      : 0;
  return {
    t,
    mode,
    precision,
    recall,
    f1: f(1),
    f05: f(0.5),
    crossLangRecall: sum.xTp / sum.xGold,
    mixedClusters: sum.mixed,
    clusters: sum.clusters,
  };
}

// Pick the threshold with the best F0.5: a wrong merge hides a question from
// the instructor, a missed merge only shows a duplicate card, so precision
// counts more.
const bestT = (emb, decks, mode) =>
  THRESHOLDS.map((t) => clusteringFor(emb, decks, t, mode)).reduce((a, b) =>
    b.f05 > a.f05 ? b : a,
  );

async function lookup(emb, db) {
  const slideVecs = emb.slides;
  const rows = [];
  for (const q of emb.questions) {
    const meta = byId.get(q.id);
    let top;
    if (db) {
      top = await topSlides(db, emb.model, meta.deck, q.vec, 3);
    } else {
      top = slideVecs
        .filter((s) => s.deck === meta.deck)
        .map((s) => ({ page: s.page, sim: dot(q.vec, s.vec) }))
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 3);
    }
    const rank = top.findIndex((r) => meta.slides.includes(r.page));
    rows.push({
      id: q.id,
      lang: meta.lang,
      answerable: meta.slides.length > 0,
      rank,
      top1Sim: top[0].sim,
      top: top.map((r) => r.page),
    });
  }
  const score = (rs) => ({
    n: rs.length,
    top1: rs.filter((r) => r.rank === 0).length / rs.length,
    top3: rs.filter((r) => r.rank >= 0).length / rs.length,
    mrr3: rs.reduce((s, r) => s + (r.rank >= 0 ? 1 / (r.rank + 1) : 0), 0) / rs.length,
  });
  const ans = rows.filter((r) => r.answerable);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    all: score(ans),
    byLang: Object.fromEntries(
      ["th", "mix", "en"].map((l) => [l, score(ans.filter((r) => r.lang === l))]),
    ),
    byDeck: Object.fromEntries(
      DECKS.map((d) => [d, score(ans.filter((r) => byId.get(r.id).deck === d))]),
    ),
    // Can a similarity floor hide suggestions for off-topic questions?
    top1SimAnswerable: mean(ans.map((r) => r.top1Sim)),
    top1SimNoAnswer: mean(rows.filter((r) => !r.answerable).map((r) => r.top1Sim)),
    misses: ans
      .filter((r) => r.rank < 0)
      .map((r) => ({ id: r.id, want: byId.get(r.id).slides, got: r.top })),
  };
}

process.loadEnvFile?.(new URL("../../../.env", import.meta.url));
let db = null;
try {
  db = await connect();
} catch {
  console.warn("pgvector not reachable; slide lookup uses brute force in JS");
}

const results = {};
for (const name of process.argv.slice(2)) {
  const file = new URL(`../out/emb-${name}.json`, import.meta.url);
  if (!existsSync(file)) {
    console.warn(`skip ${name}: run embed first`);
    continue;
  }
  const emb = JSON.parse(readFileSync(file, "utf8"));
  vecOf = new Map(emb.questions.map((q) => [q.id, q.vec]));

  const clustering = {};
  for (const mode of ["single", "centroid"]) {
    // Tune on one deck, test on the other, both ways: the threshold is not
    // fitted to the questions it is scored on.
    const held = DECKS.map((test) => {
      const train = DECKS.filter((d) => d !== test);
      const t = bestT(emb, train, mode).t;
      return { test, t, ...clusteringFor(emb, [test], t, mode) };
    });
    const oracle = bestT(emb, DECKS, mode);
    const sweep = THRESHOLDS.map((t) => clusteringFor(emb, DECKS, t, mode));
    clustering[mode] = { heldOut: held, oracle, sweep };
  }
  results[name] = {
    lookup: await lookup(emb, db),
    clustering,
    timing: {
      loadMs: emb.loadMs,
      slideMs: emb.slideMs,
      questionMs: emb.questionMs,
      queryTokens: emb.queryTokens,
      docTokens: emb.docTokens,
    },
  };

  const L = results[name].lookup;
  const pct = (x) => (100 * x).toFixed(1).padStart(5);
  console.log(`\n== ${name} ==`);
  console.log(
    `lookup  top1 ${pct(L.all.top1)}  top3 ${pct(L.all.top3)}  mrr@3 ${L.all.mrr3.toFixed(3)}  (n=${L.all.n})`,
  );
  for (const [l, s] of Object.entries(L.byLang))
    console.log(`   ${l.padEnd(4)} top3 ${pct(s.top3)} (n=${s.n})`);
  console.log(
    `   top-1 sim: answerable ${L.top1SimAnswerable.toFixed(3)}, no-answer ${L.top1SimNoAnswer.toFixed(3)}`,
  );
  for (const mode of ["single", "centroid"]) {
    const c = clustering[mode];
    for (const h of c.heldOut)
      console.log(
        `cluster ${mode.padEnd(8)} test=${h.test} t=${h.t}  P ${pct(h.precision)}  R ${pct(h.recall)}  F0.5 ${pct(h.f05)}  xlang R ${pct(h.crossLangRecall)}  mixed ${h.mixedClusters.toFixed(1)}`,
      );
    const o = c.oracle;
    console.log(
      `cluster ${mode.padEnd(8)} oracle   t=${o.t}  P ${pct(o.precision)}  R ${pct(o.recall)}  F0.5 ${pct(o.f05)}  xlang R ${pct(o.crossLangRecall)}`,
    );
  }
}

writeFileSync(new URL("../out/results.json", import.meta.url), JSON.stringify(results, null, 1));
await db?.end();
