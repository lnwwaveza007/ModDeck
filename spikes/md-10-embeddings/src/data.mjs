import { readFileSync } from "node:fs";

const SLIDES = new URL("../../md-14-pdf-import/data/slides-text.json", import.meta.url);
const QUESTIONS = new URL("../data/questions.json", import.meta.url);

export const DECK_TITLES = {
  vue: "Chapter 1 - Introduction to Vue3 Composition API and Dev Tools",
  w07: "INT 319 Development Corporate Strategy and Plan II (workshop)",
};

// Clean MD-14 text for embedding:
// - diagrams with vertical labels come out one letter per line ("O\nr\ng\na…"): join them;
// - the lecturer footer repeats on every Vue slide and only adds noise;
// - squash whitespace.
export function cleanSlideText(text) {
  return text
    .replace(
      /(?:^|\n)((?:[^\n]{1,2}\n){3,}[^\n]{1,2})(?=\n|$)/g,
      (m, run) => "\n" + run.replace(/\n/g, ""),
    )
    .replace(/^\d*Asst\.Prof\. ?Dr\. ?Umaporn Supasitthimethee$/gm, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function loadData() {
  const q = JSON.parse(readFileSync(QUESTIONS, "utf8"));
  const all = JSON.parse(readFileSync(SLIDES, "utf8"));
  const slides = [];
  for (const [deck, slug] of Object.entries(q.decks)) {
    for (const s of all.filter((s) => s.deck === slug)) {
      const text = cleanSlideText(s.text);
      // Empty slides (photo-only pages) cannot be found by text anyway.
      if (text.length < 5) continue;
      slides.push({ deck, page: s.page, title: DECK_TITLES[deck], text });
    }
  }
  return { questions: q.questions, slides };
}
