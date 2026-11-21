// Socket.IO event schema for the live channel (technical design §3.4).
// One namespace (`/`), one room per session. Client payloads are zod schemas,
// so the api validates them at runtime and both sides share the inferred types.
// Every server event carries `seq`: the per-session sequence number (MD-13).

import { z } from "zod";
import type { ErrorBody } from "./errors";
import type { LiveQuestion, ParticipantRow } from "./participants";
import type { QuestionStatus } from "./questions";
import type { PollTally, SlideActivityView } from "./live";
import type { ReactionBurst, ReactionPayload } from "./reactions";
import { WORD_TEXT_INPUT_MAX, type WordCloudTally, type WordResult } from "./words";

// ---- Client -> server ----------------------------------------------------

// First message after every (re)connect. The token comes from the handshake
// (cookie or `auth.token`), not from this payload. The host's presenter and
// audience screen connect with `auth: { role: "host" }` and the host login
// cookie instead, and may join only a session they own. `lastSeq` is the last
// event the client applied; the server replays everything after it.
export const joinPayloadSchema = z.object({
  sessionId: z.uuid(),
  lastSeq: z.int().nonnegative().optional(),
});
export type JoinPayload = z.infer<typeof joinPayloadSchema>;

// ---- Server -> client: room events ----------------------------------------

export type SessionStatus = "live" | "host_away" | "ended";
export type ActivityRunState = "draft" | "live" | "closed" | "results_shown";

// Data of each event broadcast to a session room. These events are numbered
// and kept in the replay log.
export interface RoomEventData {
  // `activity`: the activity on that slide, so 300 phones need no request of their own to draw it.
  slide_changed: { slideId: string; index: number; activity: SlideActivityView | null };
  // `endsAt`: countdown end in ms since epoch (server clock), or null without a timer.
  activity_state: {
    activityId: string;
    activityRunId: string;
    state: ActivityRunState;
    endsAt: number | null;
    reopened: boolean;
  };
  // The host fixed the wording of an activity during the session.
  activity_edited: {
    activityId: string;
    prompt: string;
    options: { id: string; label: string }[];
    maxEntries: number;
  };
  // Sent in batches, at most one per VOTE_BATCH_MS for each run.
  vote_update: { activityRunId: string } & PollTally;
  // The most sent visible words of a word cloud. Hidden words never travel in it: a phone or the
  // projector that gets it has no way to read what the host hid. Batched like vote_update.
  word_update: { activityRunId: string } & WordCloudTally;
  // Q&A mutations. New questions and votes are batched; the host's status changes go out at once.
  // Anonymous questions never include an author key or value. A `status` update carries the
  // question, so a screen can show one the host unhid, except when it is hidden: then only the id
  // travels, and no phone can read what the host hid.
  question_update: {
    updates: (
      | { action: "created"; question: LiveQuestion }
      | { action: "votes"; questionId: string; votes: number }
      | { action: "status"; questionId: string; status: "hidden" }
      | {
          action: "status";
          questionId: string;
          status: Exclude<QuestionStatus, "hidden" | "deleted">;
          question: LiveQuestion;
        }
    )[];
  };
  // The host opened or closed Q&A. `shown`: the Q&A tab shows on the phones (see qaShown).
  qa_toggled: { open: boolean; shown: boolean };
  participant_count: { online: number; total: number };
  // The host turned live reactions on or off. Numbered and replayed, so a phone that was offline
  // when it happened shows or hides its reaction bar after the reconnect.
  reactions_toggled: { enabled: boolean };
  session_ended: { reason: "host" | "timeout" };
}

export type RoomEventType = keyof RoomEventData;

export const ROOM_EVENT_TYPES = [
  "slide_changed",
  "activity_state",
  "activity_edited",
  "vote_update",
  "word_update",
  "question_update",
  "qa_toggled",
  "participant_count",
  "reactions_toggled",
  "session_ended",
] as const satisfies readonly RoomEventType[];

// Envelope of a room event. Distributes over the union, so `event.type`
// narrows `event.data`.
export type RoomEvent<T extends RoomEventType = RoomEventType> = {
  [K in T]: {
    type: K;
    seq: number;
    sessionId: string;
    at: number; // server time, ms since epoch
    data: RoomEventData[K];
  };
}[T];

// ---- Server -> client: direct events --------------------------------------

export interface SessionSnapshot {
  status: SessionStatus;
  currentSlideId: string | null;
}

// Sent after `join`. `seq` is the session's last sequence number: the client
// continues from it. "replay" lists the events after the client's `lastSeq`;
// "snapshot" is used when that event is no longer in the log (or on first join).
export type StatePayload = { sessionId: string; seq: number } & (
  { mode: "replay"; events: RoomEvent[] } | { mode: "snapshot"; snapshot: SessionSnapshot }
);

// `seq` is the last sequence number of the socket's session (0 before join).
export interface ErrorEvent extends ErrorBody {
  seq: number;
}

// `nickname`: a participant's current name, so a phone that was away during a rename catches up.
// Host sockets get none.
export type JoinAck =
  ({ ok: true; nickname?: string } & StatePayload) | { ok: false; error: ErrorBody };

// ---- Typed maps for socket.io / socket.io-client ---------------------------

export type ServerToClientEvents = {
  state: (payload: StatePayload) => void;
  error: (payload: ErrorEvent) => void;
  // Not a room event: no seq, not in the replay log, and only the host's screens get it.
  reaction_burst: (payload: ReactionBurst) => void;
  // The participant list, to the host's screens only. Not numbered either: after a reconnect the
  // host loads the list again. `participant_update` is a new or changed row (online, nickname).
  participant_update: (row: ParticipantRow) => void;
  participant_removed: (payload: { participantId: string }) => void;
  // To the renamed participant's own phones and tabs only. A phone that was away during a rename
  // gets the name in its next join ack instead.
  renamed: (payload: { nickname: string }) => void;
} & { [K in RoomEventType]: (event: RoomEvent<K>) => void };

export interface ClientToServerEvents {
  join: (payload: JoinPayload, ack: (reply: JoinAck) => void) => void;
  vote: (payload: VotePayload, ack: (reply: AnswerAck<VoteResult>) => void) => void;
  word: (payload: WordPayload, ack: (reply: AnswerAck<WordResult>) => void) => void;
  reaction: (payload: ReactionPayload) => void;
}

// ---- Answers: client-generated id for retries (MD-13) ----------------------

// Every answer the client sends (vote, word) carries one `answerId`, made once
// with crypto.randomUUID(). A retry after a lost ack re-sends the same id, so
// the server counts the answer once.
export const answerIdSchema = z.uuid();

// A student's vote. A list because multiple choice comes later: today it holds one option.
export const votePayloadSchema = z.object({
  activityRunId: z.uuid(),
  optionIds: z.array(z.uuid()).length(1),
  answerId: answerIdSchema,
});
export type VotePayload = z.infer<typeof votePayloadSchema>;

// One word for a word cloud. The text is the raw input: the server normalizes and checks it, so a
// client that skipped the checks cannot get a word past the limits.
export const wordPayloadSchema = z.object({
  activityRunId: z.uuid(),
  text: z.string().max(WORD_TEXT_INPUT_MAX),
  answerId: answerIdSchema,
});
export type WordPayload = z.infer<typeof wordPayloadSchema>;

/** What counts for this student now. It differs from what they sent when their answer is locked. */
export interface VoteResult {
  optionIds: string[];
}

// Ack of an answer. `duplicate: true` means the server already had this
// answerId: the answer counted on the first send and is not counted again.
export type AnswerAck<R = unknown> =
  { ok: true; duplicate: boolean; result?: R } | { ok: false; error: ErrorBody };
