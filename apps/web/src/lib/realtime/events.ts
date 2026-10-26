// Live channel event names and payloads (tech design §3.4, MD-2 schema + MD-13 hello/sync).
// Kept in web until packages/shared exists; then the API imports the same file.

export type ActivityState = "draft" | "live" | "closed" | "results_shown";

/** Server → client. Every one of these carries the session `seq` (MD-13). */
export interface ServerEventMap {
  slide_changed: { slideId: string; index: number };
  activity_state: { activityId: string; state: ActivityState };
  vote_update: { votes: Record<string, number>; answered: number; batch?: number };
  word_update: { words: Array<{ text: string; count: number }> };
  question_posted: { questionId: string } & Record<string, unknown>;
  question_updated: { questionId: string } & Record<string, unknown>;
  participant_count: { online: number; total: number };
  reaction_burst: Record<string, number>;
  import_progress: { importId: string; page: number; status: string };
  session_ended: { reason: "host" | "timeout" };
}

export type ServerEventName = keyof ServerEventMap;

export const SERVER_EVENTS = [
  "slide_changed",
  "activity_state",
  "vote_update",
  "word_update",
  "question_posted",
  "question_updated",
  "participant_count",
  "reaction_burst",
  "import_progress",
  "session_ended",
] as const satisfies readonly ServerEventName[];

/** One numbered server event, as received live or inside a `sync` replay. */
export type ServerEvent = {
  [K in ServerEventName]: { name: K; seq: number; payload: ServerEventMap[K] };
}[ServerEventName];

/** Client → server actions. All but `reaction` get an ack. */
export interface ClientEventMap {
  vote: { activityRunId: string; optionIds: string[]; answerId: string };
  word: { activityRunId: string; text: string; answerId: string };
  question: { text: string; anonymous: boolean; clientMsgId: string };
  upvote: { questionId: string; on: boolean };
  reaction: { emoji: string };
}

export type ClientEventName = keyof ClientEventMap;
export type AckedClientEventName = Exclude<ClientEventName, "reaction">;

export type Ack =
  | ({ ok: true; duplicate?: boolean } & Record<string, unknown>)
  | { ok: false; code: string; message?: string };

/** `hello` → ack. The participant token rides in the handshake cookie, so only lastSeq is sent. */
export interface HelloPayload {
  lastSeq: number;
}

export type SyncResult =
  | {
      ok: true;
      /** replay: `events` holds what was missed. snapshot: the log was trimmed, use `state`. */
      mode: "replay" | "snapshot";
      lastSeq: number;
      events?: ServerEvent[];
      state?: unknown;
      you?: unknown;
    }
  | { ok: false; code: string; message?: string };

/** Socket `error` event, same codes as REST (tech design §3.5). */
export interface SocketErrorPayload {
  code: string;
  message: string;
}
