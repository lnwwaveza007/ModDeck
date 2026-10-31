// REST shapes for slides in the deck editor (technical design §3.3:
// /decks/{deckId}/slides, /slide-order). A content slide is a canvas: a list of elements
// (text, code, formula, image), each with its own position and size, like a Canva page.
// Request bodies are zod schemas, so the api validates them and the editor checks the same
// limits before sending.

import { z } from "zod";
import type { DeckSummary } from "./decks";

export const SLIDE_KINDS = ["content", "poll", "word_cloud"] as const;
export type SlideKind = (typeof SLIDE_KINDS)[number];

export const ACTIVITY_SLIDE_KINDS = ["poll", "word_cloud"] as const;
export type ActivitySlideKind = (typeof ACTIVITY_SLIDE_KINDS)[number];

export function isActivityKind(kind: SlideKind): kind is ActivitySlideKind {
  return kind === "poll" || kind === "word_cloud";
}

// Short list on purpose (MD-3 §6): every grammar is shipped to the browser, so the
// list is locked. "plaintext" shows the code without colors.
export const CODE_LANGUAGES = [
  "python",
  "java",
  "sql",
  "javascript",
  "typescript",
  "c",
  "cpp",
  "bash",
  "json",
  "html",
  "css",
  "verilog",
  "plaintext",
] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];
export const DEFAULT_CODE_LANGUAGE: CodeLanguage = "python";

export function isCodeLanguage(value: string): value is CodeLanguage {
  return (CODE_LANGUAGES as readonly string[]).includes(value);
}

/** Same cap as a PDF import (150 pages) plus room to add slides after it. */
export const DECK_SLIDES_MAX = 200;
export const SLIDE_ELEMENTS_MAX = 30;

// Characters per element. Code allows well over the 50+ lines of the MD-3 test block.
export const ELEMENT_TEXT_MAX = { text: 4000, code: 20000, math: 4000 } as const;

export const SLIDE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const SLIDE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type SlideImageType = (typeof SLIDE_IMAGE_TYPES)[number];

// What the api writes for an image: a uuid and one known extension (GET /slide-images/{ref}).
export const SLIDE_IMAGE_REF_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|gif)$/;

export const TEXT_ALIGNS = ["left", "center", "right"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

// Geometry. The stage is 16:9. x and w are percent of the stage width, y and h percent of the
// stage height. Font sizes are percent of the stage width (CSS `cqw`), so a slide looks the
// same at any size: a thumbnail is a scaled copy of the projector.
const percent = (min: number) => z.number().min(min).max(100);
const geometry = { x: percent(0), y: percent(0), w: percent(2) };
const size = z.number().min(1).max(20);

export const textElementSchema = z.object({
  id: z.uuid(),
  type: z.literal("text"),
  ...geometry,
  text: z.string().max(ELEMENT_TEXT_MAX.text),
  size,
  bold: z.boolean(),
  align: z.enum(TEXT_ALIGNS),
});

export const codeElementSchema = z.object({
  id: z.uuid(),
  type: z.literal("code"),
  ...geometry,
  code: z.string().max(ELEMENT_TEXT_MAX.code),
  language: z.enum(CODE_LANGUAGES),
  size,
  // Without a height the block grows with its code. With one, long code scrolls inside it
  // (MD-3 §6: scroll, do not shrink below a readable size).
  h: percent(2).optional(),
});

export const mathElementSchema = z.object({
  id: z.uuid(),
  type: z.literal("math"),
  ...geometry,
  // Not checked for LaTeX syntax: a formula that does not parse shows an inline error.
  latex: z.string().max(ELEMENT_TEXT_MAX.math),
  size,
  align: z.enum(TEXT_ALIGNS),
});

export const imageElementSchema = z.object({
  id: z.uuid(),
  type: z.literal("image"),
  ...geometry,
  h: percent(2),
  imageRef: z.string().regex(SLIDE_IMAGE_REF_PATTERN).nullable(),
});

export const slideElementSchema = z.discriminatedUnion("type", [
  textElementSchema,
  codeElementSchema,
  mathElementSchema,
  imageElementSchema,
]);

export type TextElement = z.infer<typeof textElementSchema>;
export type CodeElement = z.infer<typeof codeElementSchema>;
export type MathElement = z.infer<typeof mathElementSchema>;
export type ImageElement = z.infer<typeof imageElementSchema>;
export type SlideElement = z.infer<typeof slideElementSchema>;
export type SlideElementType = SlideElement["type"];

export const slideElementsSchema = z.array(slideElementSchema).max(SLIDE_ELEMENTS_MAX);

export const slideKindSchema = z.enum(SLIDE_KINDS);

// POST /decks/{deckId}/slides. `position` is the index the slide takes; without it the slide
// goes to the end. Only a content slide takes elements.
export const slideCreateBodySchema = z.object({
  kind: slideKindSchema,
  position: z.int().min(0).optional(),
  elements: slideElementsSchema.optional(),
});
export type SlideCreateBody = z.infer<typeof slideCreateBodySchema>;

// PATCH /decks/{deckId}/slides/{slideId}: the whole element list, in back-to-front order.
export const slidePatchBodySchema = z.object({ elements: slideElementsSchema });
export type SlidePatchBody = z.infer<typeof slidePatchBodySchema>;

// PUT /decks/{deckId}/slide-order: every slide of the deck, in the new order.
export const slideOrderBodySchema = z.object({
  slideIds: z.array(z.uuid()).max(DECK_SLIDES_MAX),
});
export type SlideOrderBody = z.infer<typeof slideOrderBodySchema>;

/** One slide in the editor, the presenter and the audience screen. Times are ISO 8601 UTC. */
export interface SlideDto {
  id: string;
  position: number;
  kind: SlideKind;
  // Content slides only: back to front. Always empty on activity slides.
  elements: SlideElement[];
  // Activity slides only. The editors for polls and word clouds come with R1-13 and R1-16.
  activity: { type: ActivitySlideKind; prompt: string } | null;
  updatedAt: string;
}

/** GET /decks/{deckId}: the card data plus the slides in order. */
export interface DeckDetail extends DeckSummary {
  slides: SlideDto[];
}

/** POST /decks/{deckId}/slide-images: the file is stored, then an image element points at it. */
export interface SlideImageDto {
  imageRef: string;
}
