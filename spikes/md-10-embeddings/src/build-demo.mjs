// Build demo/index.html: the question board, with real similarity scores
// from the bge-m3-q8 run embedded. Run embed.mjs for bge-m3-q8 first.
//   node src/build-demo.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { DECK_TITLES, loadData } from "./data.mjs";

const { questions, slides } = loadData();
const emb = JSON.parse(readFileSync(new URL("../out/emb-bge-m3-q8.json", import.meta.url), "utf8"));
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const qvec = new Map(emb.questions.map((q) => [q.id, q.vec]));
const svec = new Map(emb.slides.map((s) => [`${s.deck}:${s.page}`, s.vec]));

// Short, single-line excerpt. The title slide holds names and contact details,
// so it is not shown.
const short = (t) => {
  const one = t.replace(/\s+/g, " ").trim();
  return one.length > 150 ? `${one.slice(0, 147)}…` : one;
};

const data = { decks: {} };
for (const deck of ["vue", "w07"]) {
  const ds = slides.filter((s) => s.deck === deck);
  const qs = questions.filter((q) => q.deck === deck);
  data.decks[deck] = {
    title: DECK_TITLES[deck],
    slides: ds.map((s) => ({ page: s.page, text: s.page === 1 ? "Title slide" : short(s.text) })),
    questions: qs.map((q) => ({
      id: q.id,
      text: q.text,
      lang: q.lang,
      group: q.group,
      gold: q.slides,
      top: ds
        .map((s) => ({ page: s.page, sim: dot(qvec.get(q.id), svec.get(`${deck}:${s.page}`)) }))
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 3)
        .map((r) => ({ page: r.page, sim: +r.sim.toFixed(3) })),
    })),
    sim: qs.map((a) => qs.map((b) => +dot(qvec.get(a.id), qvec.get(b.id)).toFixed(2))),
  };
}

const template = readFileSync(new URL("../demo/template.html", import.meta.url), "utf8");
if (!template.includes("__DATA__")) throw new Error("demo/template.html has no __DATA__ marker");
const html = template.replace("__DATA__", () => JSON.stringify(data).replace(/</g, "\\u003c"));
writeFileSync(new URL("../demo/index.html", import.meta.url), html);

for (const [k, d] of Object.entries(data.decks)) {
  console.log(`${k}: ${d.slides.length} slides, ${d.questions.length} questions`);
}
console.log("wrote demo/index.html");
