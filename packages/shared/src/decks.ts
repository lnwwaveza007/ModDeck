// REST shapes for My decks (technical design §3.3: /decks, /decks/{deckId}/copies).
// Request bodies are zod schemas, so the api validates them and the web form
// checks the same rules before sending.

import { z } from "zod";

export const DECK_TITLE_MAX = 120;

export const deckTitleSchema = z.string().trim().min(1).max(DECK_TITLE_MAX);

// POST /decks and PATCH /decks/{deckId}.
export const deckTitleBodySchema = z.object({ title: deckTitleSchema });
export type DeckTitleBody = z.infer<typeof deckTitleBodySchema>;

// POST /decks/{deckId}/copies. The web sends "Copy of …" in the host's
// language; without a title the api appends " (copy)".
export const deckCopyBodySchema = z.object({ title: deckTitleSchema.optional() }).optional();
export type DeckCopyBody = z.infer<typeof deckCopyBodySchema>;

/** One card on My decks. Times are ISO 8601 UTC. */
export interface DeckSummary {
  id: string;
  title: string;
  slideCount: number;
  // Every session ever run from the deck, live ones included.
  sessionCount: number;
  // A host may run the same deck twice at once (MD-5 §7): "2 live".
  liveSessions: { id: string; pin: string }[];
  createdAt: string;
  updatedAt: string;
}
