// Live reactions (F11, R1-15): a student taps one of a fixed set of emojis and it floats up on the
// projector. Reactions are live only: nothing is saved, and they never enter the replay log.

import { z } from "zod";

// The bar on the student screen, in display order.
export const REACTION_EMOJIS = ["👏", "❤️", "😂", "😮", "🎉"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

// One participant may send one reaction this often. The server drops the rest.
export const REACTION_INTERVAL_MS = 1000;

// The server adds up the taps of a room and sends them to the projector at most this often, so
// 300 students tapping at once cost the projector 4 messages a second, not 300.
export const REACTION_BATCH_MS = 250;

// The projector draws at most this many emojis at the same time. A bigger burst shows this many.
export const REACTION_MAX_ON_SCREEN = 30;

// C → S `reaction`. No ack: a lost reaction is not worth a retry.
export const reactionPayloadSchema = z.object({ emoji: z.enum(REACTION_EMOJIS) });
export type ReactionPayload = z.infer<typeof reactionPayloadSchema>;

// S → C `reaction_burst`: the taps of one batch, by emoji. Only the host's screens get it.
export interface ReactionBurst {
  sessionId: string;
  counts: Partial<Record<ReactionEmoji, number>>;
}

// PATCH /sessions/{sessionId} { reactionsEnabled }: the host turns reactions on or off.
export const reactionsToggleBodySchema = z.object({ reactionsEnabled: z.boolean() });
export type ReactionsToggleBody = z.infer<typeof reactionsToggleBodySchema>;
