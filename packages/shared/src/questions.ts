// Host Q&A moderation (F6): the host marks a question answered, hides it, or pins one question
// large on the projector, and opens or closes Q&A for the session.

import { z } from "zod";

// The `question_status` enum. `highlighted` is the question pinned to the projector: at most one
// per session. `deleted` is not used in R1.
export const QUESTION_STATUSES = [
  "visible",
  "highlighted",
  "answered",
  "hidden",
  "deleted",
] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

// What the host can do to one question. Each one sets a status:
// answer → answered, hide → hidden, pin → highlighted (and the old pin goes back to visible),
// and restore → visible (unpin, unhide, or undo answered).
export const QUESTION_ACTIONS = ["answer", "hide", "pin", "restore"] as const;
export type QuestionAction = (typeof QUESTION_ACTIONS)[number];

export const QUESTION_ACTION_STATUS = {
  answer: "answered",
  hide: "hidden",
  pin: "highlighted",
  restore: "visible",
} as const satisfies Record<QuestionAction, QuestionStatus>;

// PATCH /sessions/{sessionId}/questions/{questionId}/status { action }: owner only.
export const questionActionBodySchema = z.object({ action: z.enum(QUESTION_ACTIONS) });
export type QuestionActionBody = z.infer<typeof questionActionBodySchema>;

// PATCH /sessions/{sessionId} { qaOpen }: the host opens or closes Q&A. Closed, students can still
// read the list, but cannot ask or vote.
export const qaToggleBodySchema = z.object({ qaOpen: z.boolean() });
export type QaToggleBody = z.infer<typeof qaToggleBodySchema>;

// Session settings: `qaEnabled` is the open/close switch, copied from the deck at start.
// `qaWasOpen` remembers that Q&A has been open once in this session.
type QaSettings = { qaEnabled?: boolean; qaWasOpen?: boolean } | null;

/** Q&A is open unless the session's settings close it. */
export function qaOpen(settings: unknown): boolean {
  return (settings as QaSettings)?.qaEnabled !== false;
}

/**
 * Students see the Q&A tab. Once Q&A has been open, the tab stays after a close, so the room can
 * still read what was asked. A deck that starts with Q&A off shows no tab until the host opens it.
 */
export function qaShown(settings: unknown): boolean {
  return qaOpen(settings) || (settings as QaSettings)?.qaWasOpen === true;
}
