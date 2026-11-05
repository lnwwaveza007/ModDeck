// Limits used by both web and api. Source: docs/exam02/technical-design.md.

export const PIN_PATTERN = /^\d{6}$/;

// One room holds at most this many participants (MD-8).
export const MAX_PARTICIPANTS = 300;

// Server events kept per session for replay after a reconnect (MD-13). A client
// further behind than this gets a snapshot instead.
export const EVENT_LOG_SIZE = 500;

// Vote counts go to a room at most this often per poll (100 to 200 ms, R1-13). Votes that arrive in
// between travel together in the next update.
export const VOTE_BATCH_MS = 150;

// HttpOnly cookie that holds the participant token (MD-7, MD-13).
export const PARTICIPANT_COOKIE = "moddeck_pt";

// An offline participant keeps their seat this long (MD-5 rule 9, Q22). After
// it the seat counts as free for a new person.
export const SEAT_HOLD_MS = 15 * 60 * 1000;

// A connected socket refreshes Participant.lastSeenAt this often, so the seat
// hold clock starts from the last moment the participant was really online.
export const PRESENCE_HEARTBEAT_MS = 60 * 1000;
