// Limits used by both web and api. Source: docs/exam02/technical-design.md.

export const PIN_PATTERN = /^\d{6}$/;

// One room holds at most this many participants (MD-8).
export const MAX_PARTICIPANTS = 300;

// Server events kept per session for replay after a reconnect (MD-13). A client
// further behind than this gets a snapshot instead.
export const EVENT_LOG_SIZE = 500;

// HttpOnly cookie that holds the participant token (MD-7, MD-13).
export const PARTICIPANT_COOKIE = "moddeck_pt";
