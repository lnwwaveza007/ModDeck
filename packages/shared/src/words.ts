// Word Cloud rules shared by the api and the web (MD-5 §2.6, technical design §3.4). The phone
// checks a word before it sends, and the api checks it again: the server is what counts.

import { z } from "zod";
import { graphemeLength } from "./participants";

/** Visible characters per entry. Thai counts a consonant with its vowels and tone marks as 1. */
export const WORD_MAX_LENGTH = 25;

/** Entries each student may send to one word cloud (the host picks 1 to 3, default 1). */
export const WORD_ENTRIES_MIN = 1;
export const WORD_ENTRIES_MAX = 3;
export const WORD_ENTRIES_DEFAULT = 1;

/** The cloud on a screen holds the most sent words only: the rest are too small to read. */
export const WORD_CLOUD_TOP_N = 60;

/** Raw text a phone may send. The real limit is WORD_MAX_LENGTH after normalizing. */
export const WORD_TEXT_INPUT_MAX = 200;

// Characters that are not seen but make two identical words differ: zero width space, word
// joiner, byte order mark. Thai typists use the zero width space as a word break.
const INVISIBLE = /[\u200B\u2060\uFEFF]/g;

/**
 * The word as it shows on screen. It is never split: Thai has no spaces, so one entry is one word
 * or phrase as typed. NFC (not NFKC) joins the marks of one character in a fixed order and keeps
 * sara am (ำ) as it is; NFKC would break it into two characters.
 */
export function normalizeWordText(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(INVISIBLE, "")
    .replace(/[\s\p{Cc}]+/gu, " ")
    .trim();
}

/**
 * What makes two entries the same word: trimmed, compared ignoring case and spaces (MD-5 §2.6).
 * "Cloud", "cloud " and "CLOUD" are one word. Thai has no case, so it is only trimmed and joined.
 */
export function wordKey(raw: string): string {
  return normalizeWordText(raw).replace(/ /g, "").toLowerCase();
}

export type WordProblem = "EMPTY" | "TOO_LONG";

/** null when the word may be sent. `raw` can be typed text: it is normalized first. */
export function wordProblem(raw: string): WordProblem | null {
  const text = normalizeWordText(raw);
  if (text.length === 0) return "EMPTY";
  if (graphemeLength(text) > WORD_MAX_LENGTH) return "TOO_LONG";
  return null;
}

/** Number of visible characters of a word, for the counter under the text field. */
export const wordLength = (raw: string) => graphemeLength(normalizeWordText(raw));

/** One word of a cloud. `key` is what the host hides (see wordKey), `text` is how it is shown. */
export interface WordCount {
  key: string;
  text: string;
  count: number;
}

/**
 * What a screen draws. `words` holds the most sent visible words, the largest first. `entries` is
 * every entry sent to the run, hidden ones included: the response count of the stage.
 */
export interface WordCloudTally {
  words: WordCount[];
  entries: number;
}

/** What counts for this student after an entry: the text as stored, and how many they have sent. */
export interface WordResult {
  text: string;
  sent: number;
}

// PATCH /sessions/{sessionId}/activities/{activityId}/words/{wordKey}: hide or show one word.
export const wordVisibilityBodySchema = z.object({ hidden: z.boolean() }).strict();
export type WordVisibilityBody = z.infer<typeof wordVisibilityBodySchema>;

/** The word after the change, and every hidden word of the run, so the host can show one again. */
export interface WordVisibilityResult {
  key: string;
  hidden: boolean;
  hiddenWords: WordCount[];
}

/** Orders words for display: most sent first, then by text so the order never flickers. */
export function sortWords<T extends { text: string; count: number }>(words: T[]): T[] {
  return [...words].sort(
    (a, b) => b.count - a.count || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0),
  );
}
