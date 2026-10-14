// Flatten run 1 of each provider/deck into rateable items.
import { readdirSync, readFileSync, existsSync } from "node:fs";

const OUT = new URL("../out/", import.meta.url);

export function loadRuns() {
  if (!existsSync(OUT)) return [];
  const runs = [];
  for (const provider of readdirSync(OUT)) {
    const dir = new URL(`${provider}/`, OUT);
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      runs.push(JSON.parse(readFileSync(new URL(f, dir), "utf8")));
    }
  }
  return runs;
}

export function loadItems() {
  const items = [];
  for (const run of loadRuns()) {
    const first = run.results.find((r) => r.json);
    if (!first) continue;
    first.json.suggestions.forEach((s, i) =>
      items.push({
        id: `${run.provider}:${run.deck}:${i + 1}`,
        provider: run.provider,
        deck: run.deck,
        lang: run.lang,
        slides: run.slides,
        ...s,
      }),
    );
  }
  return items;
}

const thaiShare = (t) =>
  (t.match(/[\u0E00-\u0E7F]/g) ?? []).length / Math.max(1, t.replace(/\s/g, "").length);

// Mechanical problems a teacher would have to fix. Empty array = none found.
export function autoChecks(it) {
  const p = [];
  if (it.after_slide < 2 || it.after_slide >= it.slides)
    p.push("position: after title slide, last slide or out of range");
  if (it.options.length < 2 || it.options.length > 5) p.push(`options: ${it.options.length}`);
  if (new Set(it.options.map((o) => o.trim().toLowerCase())).size !== it.options.length)
    p.push("options: duplicate");
  if (it.type === "quiz" && !(it.correct_option >= 0 && it.correct_option < it.options.length))
    p.push("quiz: no valid correct option");
  if (it.type === "poll" && it.correct_option !== -1) p.push("poll: has a correct option");
  const th = thaiShare(it.question);
  if (it.lang === "th" && th < 0.3) p.push("language: English question on a Thai deck");
  return p;
}
