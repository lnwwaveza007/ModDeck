// Usage: node src/check.mjs   -> latency, tokens, cost and mechanical checks per provider and deck.
import { writeFileSync } from "node:fs";
import { loadRuns, loadItems, autoChecks } from "./items.mjs";

// USD per 1M tokens. Output price includes thinking tokens.
// gemini-3.8-flash: official intro price until 31 Dec 2026 (ai.google.dev "What's new"); $1.50 / $7.50 from 1 Jan 2027.
// gemini-3.1-flash-lite: OpenRouter / third-party listing, not confirmed on ai.google.dev.
export const PRICES = {
  "gemini-3.8-flash": { in: 0.75, out: 3.75, in2027: 1.5, out2027: 7.5 },
  "gemini-3.8-flash-low": { in: 0.75, out: 3.75, in2027: 1.5, out2027: 7.5 },
  "gemini-3.1-flash-lite": { in: 0.25, out: 1.5 },
};

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length
    ? s.length % 2
      ? s[(s.length - 1) / 2]
      : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
    : NaN;
};
const cost = (p, r, late = false) =>
  p
    ? (r.inTokens * (late ? (p.in2027 ?? p.in) : p.in) +
        (r.outTokens + r.thinkTokens) * (late ? (p.out2027 ?? p.out) : p.out)) /
      1e6
    : NaN;

const rows = [];
for (const run of loadRuns().sort((a, b) =>
  (a.provider + a.deck).localeCompare(b.provider + b.deck),
)) {
  const ok = run.results.filter((r) => r.json);
  const p = PRICES[run.provider];
  rows.push({
    provider: run.provider,
    deck: run.deck,
    lang: run.lang,
    slides: run.slides,
    runs: run.results.length,
    errors: run.results.length - ok.length,
    msAll: ok.map((r) => Math.round(r.ms)),
    msMedian: Math.round(median(ok.map((r) => r.ms))),
    msMax: Math.round(Math.max(...ok.map((r) => r.ms))),
    inTokens: median(ok.map((r) => r.inTokens)),
    outTokens: median(ok.map((r) => r.outTokens)),
    thinkTokens: median(ok.map((r) => r.thinkTokens)),
    costUsd: median(ok.map((r) => cost(p, r))),
    cost2027Usd: median(ok.map((r) => cost(p, r, true))),
    suggestions: ok.map((r) => r.json.suggestions.length),
  });
}

const items = loadItems().map((it) => ({
  id: it.id,
  problems: autoChecks(it),
  type: it.type,
  correct: it.correct_option,
}));
writeFileSync(
  new URL("../data/metrics.json", import.meta.url),
  JSON.stringify({ rows, items }, null, 2),
);

console.log(
  "provider\tdeck\tlang\tslides\truns\terr\tmedian s\tmax s\tin\tout\tthink\tUSD/deck\tUSD 2027\tsugg",
);
for (const r of rows)
  if (r.errors === r.runs)
    console.log(
      [r.provider, r.deck, r.lang, r.slides, r.runs, r.errors, "all runs failed"].join("	"),
    );
  else
    console.log(
      [
        r.provider,
        r.deck,
        r.lang,
        r.slides,
        r.runs,
        r.errors,
        (r.msMedian / 1000).toFixed(1),
        (r.msMax / 1000).toFixed(1),
        r.inTokens,
        r.outTokens,
        r.thinkTokens,
        r.costUsd.toFixed(5),
        r.cost2027Usd.toFixed(5),
        r.suggestions.join("/"),
      ].join("\t"),
    );
console.log("\nmechanical problems (run 1):");
for (const it of items.filter((i) => i.problems.length))
  console.log(`  ${it.id}: ${it.problems.join("; ")}`);
const byProv = Object.groupBy(items, (i) => i.id.split(":")[0]);
for (const [p, list] of Object.entries(byProv)) {
  const quiz = list.filter((i) => i.type === "quiz");
  const pos = Object.entries(Object.groupBy(quiz, (i) => i.correct))
    .map(([k, v]) => `${k}:${v.length}`)
    .join(" ");
  console.log(`${p}: ${list.length} items, ${quiz.length} quiz, correct-option position ${pos}`);
}
