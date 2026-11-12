// Stable error codes for REST and socket errors (technical design §3.5). The
// frontend maps each code to Thai / English text; `message` is for developers.

export const ERROR_CODES = [
  "UNAUTHORIZED",
  "TOKEN_EXPIRED",
  "PARTICIPANT_REMOVED",
  "SESSION_ENDED",
  "ROOM_FORBIDDEN",
  "INVALID_PAYLOAD",
  "NOT_FOUND",
  "DECK_LIVE",
  "DECK_INCOMPLETE",
  "IMPORT_RUNNING",
  "ACTIVITY_LOCKED",
  "INVALID_TRANSITION",
  "ACTIVITY_CLOSED",
  "LIMIT_REACHED",
  "SESSION_FULL",
  "LOGIN_REQUIRED",
  "NICKNAME_TAKEN",
  "NICKNAME_INVALID",
  "TOO_MANY_ATTEMPTS",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}
