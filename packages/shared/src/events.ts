// Socket.IO event schema for the live channel (technical design §3.4).
// One namespace (`/`), one room per session. Client payloads are zod schemas,
// so the api validates them at runtime and both sides share the inferred types.
// Every server event carries `seq`: the per-session sequence number (MD-13).

import { z } from "zod";
import type { ErrorBody } from "./errors";

// ---- Client -> server ----------------------------------------------------

// First message after every (re)connect. The token comes from the handshake
// (cookie or `auth.token`), not from this payload. `lastSeq` is the last
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
  slide_changed: { slideId: string; index: number };
  activity_state: { activityId: string; activityRunId: string; state: ActivityRunState };
  // Coalesced per room, max 1 per 50 ms (MD-8).
  vote_update: { activityRunId: string; votes: Record<string, number>; answered: number };
  word_update: { activityRunId: string; words: { text: string; count: number }[] };
  participant_count: { online: number; total: number };
  session_ended: { reason: "host" | "timeout" };
}

export type RoomEventType = keyof RoomEventData;

export const ROOM_EVENT_TYPES = [
  "slide_changed",
  "activity_state",
  "vote_update",
  "word_update",
  "participant_count",
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

export type JoinAck = ({ ok: true } & StatePayload) | { ok: false; error: ErrorBody };

// ---- Typed maps for socket.io / socket.io-client ---------------------------

export type ServerToClientEvents = {
  state: (payload: StatePayload) => void;
  error: (payload: ErrorEvent) => void;
} & { [K in RoomEventType]: (event: RoomEvent<K>) => void };

export interface ClientToServerEvents {
  join: (payload: JoinPayload, ack: (reply: JoinAck) => void) => void;
}
