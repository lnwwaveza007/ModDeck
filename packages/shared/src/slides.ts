// REST shapes for slides in the deck editor (technical design §3.3:
// /decks/{deckId}/slides, /slide-order). Request bodies are zod schemas, so the
// api validates them and the editor checks the same limits before sending.

import { z } from "zod";
import type { DeckSummary } from "./decks";

export const SLIDE_KINDS = ["text", "code", "math", "image", "poll", "word_cloud"] as const;
export type SlideKind = (typeof SLIDE_KINDS)[number];

/** Slides the host writes in the editor (F8). The others are activity slides (F5, F6). */
export const CONTENT_SLIDE_KINDS = ["text", "code", "math", "image"] as const;
export type ContentSlideKind = (typeof CONTENT_SLIDE_KINDS)[number];

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

// Characters per slide. Code allows well over the 50+ lines of the MD-3 test block.
export const SLIDE_CONTENT_MAX: Record<"text" | "code" | "math", number> = {
  text: 4000,
  code: 20000,
  math: 4000,
};

/** Same cap as a PDF import (150 pages) plus room to add slides after it. */
export const DECK_SLIDES_MAX = 200;

export const SLIDE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const SLIDE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type SlideImageType = (typeof SLIDE_IMAGE_TYPES)[number];

export const slideKindSchema = z.enum(SLIDE_KINDS);
export const codeLanguageSchema = z.enum(CODE_LANGUAGES);

// POST /decks/{deckId}/slides. `position` is the index the slide takes; without it the slide
// goes to the end.
export const slideCreateBodySchema = z.object({
  kind: slideKindSchema,
  position: z.int().min(0).optional(),
  content: z.string().optional(),
  language: codeLanguageSchema.optional(),
});
export type SlideCreateBody = z.infer<typeof slideCreateBodySchema>;

// PATCH /decks/{deckId}/slides/{slideId}. The kind never changes after creation.
export const slidePatchBodySchema = z
  .object({
    content: z.string().optional(),
    language: codeLanguageSchema.optional(),
  })
  .refine((body) => body.content !== undefined || body.language !== undefined);
export type SlidePatchBody = z.infer<typeof slidePatchBodySchema>;

// PUT /decks/{deckId}/slide-order: every slide of the deck, in the new order.
export const slideOrderBodySchema = z.object({
  slideIds: z.array(z.uuid()).max(DECK_SLIDES_MAX),
});
export type SlideOrderBody = z.infer<typeof slideOrderBodySchema>;

/** Why `content` does not fit the slide kind, or null when it does. Invalid LaTeX is not an error here. */
export function slideContentError(
  kind: SlideKind,
  content: string,
): "too_long" | "not_allowed" | null {
  if (kind === "text" || kind === "code" || kind === "math") {
    return content.length > SLIDE_CONTENT_MAX[kind] ? "too_long" : null;
  }
  return content === "" ? null : "not_allowed";
}

/** One slide in the editor, the presenter and the audience screen. Times are ISO 8601 UTC. */
export interface SlideDto {
  id: string;
  position: number;
  kind: SlideKind;
  // Text, code or LaTeX source. Null for image and activity slides.
  content: string | null;
  // Code slides only.
  language: CodeLanguage | null;
  // Image slides only: file name under GET /slide-images/{imageRef}.
  imageRef: string | null;
  // Activity slides only. The editors for polls and word clouds come with R1-13 and R1-16.
  activity: { type: ActivitySlideKind; prompt: string } | null;
  updatedAt: string;
}

/** GET /decks/{deckId}: the card data plus the slides in order. */
export interface DeckDetail extends DeckSummary {
  slides: SlideDto[];
}
