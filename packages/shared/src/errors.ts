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
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}
