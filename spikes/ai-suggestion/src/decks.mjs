import { readFileSync } from "node:fs";
import { cleanSlideText } from "../../md-10-embeddings/src/data.mjs";

const SLIDES = new URL("../../md-14-pdf-import/data/slides-text.json", import.meta.url);

// Two English and two Thai decks from the MD-14 import.
export const DECKS = {
  vue1: {
    slug: "chapter1-introductiontovue",
    lang: "en",
    title: "Chapter 1 - Introduction to Vue 3 Composition API and Dev Tools",
  },
  vue3: {
    slug: "chapter3-reactiveformbinding",
    lang: "en",
    title: "Chapter 3 - Reactive Form Binding",
  },
  w07: {
    slug: "int319-w07-development-of-corporate-strategy-and-plan-ii-workshop-g1",
    lang: "th",
    title: "INT319 W07 Development of Corporate Strategy and Plan II",
  },
  w08: {
    slug: "int319-w08-business-function-marketing",
    lang: "th",
    title: "INT319 W08 Business Function: Marketing",
  },
};

// Lecturer contact details on title slides add nothing and must not leave the machine.
export const redact = (t) =>
  t
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/(?:\+66|0)\d{1,2}[-\s]?\d{3}[-\s]?\d{3,4}/g, "[phone]");

export function loadDeck(id) {
  const d = DECKS[id];
  if (!d) throw new Error(`unknown deck ${id}; try ${Object.keys(DECKS).join(", ")}`);
  const all = JSON.parse(readFileSync(SLIDES, "utf8"));
  const slides = all
    .filter((s) => s.deck === d.slug)
    .sort((a, b) => a.page - b.page)
    .map((s) => ({ page: s.page, text: redact(cleanSlideText(s.text)) }));
  return { id, ...d, slides };
}

// One block per slide, so the model can refer to slide numbers.
export const deckToText = (deck) =>
  deck.slides.map((s) => `[Slide ${s.page}]\n${s.text || "(no text: picture only)"}`).join("\n\n");
