// Student join (F2, technical design §3.3 "Join and participants") and the
// nickname rules of MD-5 §2.6. The api and the join form check the same rules.

import { z } from "zod";

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 20;

// Names a guest may not take, compared case-insensitively (MD-5 §2.6). The
// host's own display name is refused too; the api adds it per session.
export const RESERVED_NICKNAMES = [
  "admin",
  "host",
  "teacher",
  "ajarn",
  "อาจารย์",
  "ผู้ดูแล",
  "ta",
] as const;

export type NicknameProblem = "TOO_SHORT" | "TOO_LONG" | "INVALID_CHARS" | "RESERVED";

// Thai, English letters, digits and single spaces (MD-5 §2.6).
const NICKNAME_CHARS = /^[A-Za-z0-9฀-๿ ]+$/;

/** Visible characters: a Thai consonant with its vowel and tone marks counts as 1. */
export function graphemeLength(text: string): number {
  return [...new Intl.Segmenter("th", { granularity: "grapheme" }).segment(text)].length;
}

/** Trims and collapses runs of spaces, so "  Ploy   P " and "Ploy P" are the same name. */
export function normalizeNickname(raw: string): string {
  return raw.normalize("NFC").trim().replace(/\s+/g, " ");
}

/** Same name for the uniqueness and reserved checks: "Ploy" and "ploy" collide. */
export const nicknameKey = (nickname: string) => normalizeNickname(nickname).toLowerCase();

/** null when the (normalized) nickname is allowed. */
export function nicknameProblem(
  nickname: string,
  reserved: readonly string[] = [],
): NicknameProblem | null {
  const length = graphemeLength(nickname);
  if (length < NICKNAME_MIN) return "TOO_SHORT";
  if (length > NICKNAME_MAX) return "TOO_LONG";
  if (!NICKNAME_CHARS.test(nickname)) return "INVALID_CHARS";
  const key = nicknameKey(nickname);
  if ([...RESERVED_NICKNAMES, ...reserved].some((name) => nicknameKey(name) === key)) {
    return "RESERVED";
  }
  return null;
}

// POST /pins/{pin}/participants. A guest sends a nickname. Without one the api
// joins with the KMUTT login (host_session cookie).
export const joinBodySchema = z.object({ nickname: z.string().max(200).optional() }).optional();
export type JoinBody = z.infer<typeof joinBodySchema>;

export type LoginType = "sso" | "guest";

/** GET /pins/{pin}: what the join screen needs before the student picks an identity. */
export interface PinInfo {
  status: "live" | "host_away";
  title: string;
  hostName: string;
  participantCount: number;
  /** "Require KMUTT login" is on: hide the guest option. */
  requireLogin: boolean;
  /** This browser already joined this session (participant cookie). */
  joined: { sessionId: string; nickname: string } | null;
}

/** POST /pins/{pin}/participants: 201 for a new participant, 200 for a rejoin. */
export interface JoinResult {
  participantId: string;
  sessionId: string;
  loginType: LoginType;
  nickname: string;
}

/** GET /participants/me: the live screen's first load, before the socket connects. */
export interface ParticipantMe extends JoinResult {
  title: string;
  status: "live" | "host_away" | "ended";
  slideCount: number;
  /** null before the host shows the first slide. `index` starts at 0. */
  currentSlide: { id: string; index: number } | null;
}
