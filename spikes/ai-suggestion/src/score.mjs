// Usage: node src/score.mjs data/ratings-<rater>.json
// Pass: at least 70% of suggestions rated usable or edit needed, in Thai and in English, per provider.
import { readFileSync } from "node:fs";
import { loadItems } from "./items.mjs";

const file = process.argv[2];
if (!file) throw new Error("usage: node src/score.mjs <ratings.json>");
const { rater, ratings } = JSON.parse(readFileSync(file, "utf8"));
const items = loadItems().map((it) => ({ ...it, rating: ratings[it.id]?.rating }));
const missing = items.filter((i) => !i.rating);
console.log(`rater: ${rater}, rated ${items.length - missing.length} / ${items.length}`);

const groups = Object.groupBy(
  items.filter((i) => i.rating),
  (i) => `${i.provider}\t${i.lang}`,
);
console.log("provider\tlang\tn\tusable\tedit\tunusable\tusable+edit\tpass");
for (const [k, list] of Object.entries(groups).sort()) {
  const c = (r) => list.filter((i) => i.rating === r).length;
  const share = (c("usable") + c("edit")) / list.length;
  console.log(
    `${k}\t${list.length}\t${c("usable")}\t${c("edit")}\t${c("unusable")}\t${(share * 100).toFixed(0)}%\t${share >= 0.7 ? "PASS" : "FAIL"}`,
  );
}
