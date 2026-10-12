// Embed slides and questions with each model, save vectors to out/, and load
// them into pgvector.
//   node src/embed.mjs e5-small e5-base bge-m3 gemini-2

import { mkdirSync, writeFileSync } from "node:fs";
import { loadData } from "./data.mjs";
import { loadModel } from "./models.mjs";
import { connect, insertQuestions, insertSlides, resetTables } from "./db.mjs";

process.loadEnvFile?.(new URL("../../../.env", import.meta.url));
mkdirSync(new URL("../out/", import.meta.url), { recursive: true });

const names = process.argv.slice(2);
if (!names.length) throw new Error("usage: node src/embed.mjs <model> [...]");

const { questions, slides } = loadData();
console.log(`${slides.length} slides, ${questions.length} questions`);

let db = null;
try {
  db = await connect();
} catch (e) {
  console.warn(`pgvector not reachable (${e.message}); vectors saved to out/ only`);
}

for (const name of names) {
  const m = await loadModel(name);
  console.log(`\n${name}: loaded in ${(m.loadMs / 1000).toFixed(1)} s on ${m.device}`);

  let t0 = performance.now();
  const slideVecs = await m.embedDocs(slides);
  const slideMs = performance.now() - t0;

  t0 = performance.now();
  const questionVecs = await m.embedQueries(questions.map((q) => q.text));
  const questionMs = performance.now() - t0;

  const queryTokens = await m.countTokens(questions.map((q) => m.query(q.text)));
  const docTokens = await m.countTokens(slides.map(m.doc));

  console.log(
    `  slides ${(slideMs / 1000).toFixed(1)} s, questions ${(questionMs / 1000).toFixed(1)} s (batched), ` +
      `tokens: questions ${queryTokens ?? "n/a"}, slides ${docTokens ?? "n/a"}`,
  );

  writeFileSync(
    new URL(`../out/emb-${name}.json`, import.meta.url),
    JSON.stringify({
      model: name,
      dims: m.dims,
      device: m.device,
      dtype: m.dtype,
      loadMs: m.loadMs,
      slideMs,
      questionMs,
      queryTokens,
      docTokens,
      slides: slides.map((s, i) => ({ deck: s.deck, page: s.page, vec: slideVecs[i] })),
      questions: questions.map((q, i) => ({ id: q.id, vec: questionVecs[i] })),
    }),
  );

  if (db) {
    await resetTables(db, name, m.dims);
    await insertSlides(db, name, slides, slideVecs);
    await insertQuestions(db, name, questions, questionVecs);
    console.log("  loaded into pgvector");
  }
}

await db?.end();
