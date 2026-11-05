import { createHash } from "node:crypto";
import { PARTICIPANT_COOKIE } from "@moddeck/shared";
import type { Socket } from "socket.io";
import { SESSION_COOKIE } from "../auth/cookies";

// Only the SHA-256 of a participant token is stored (Participant.tokenHash).
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// The browser sends the HttpOnly cookie with the handshake. Other clients
// (tests, the PowerPoint add-in) pass `auth: { token }` instead.
export function tokenFromHandshake(handshake: Socket["handshake"]): string | undefined {
  const fromAuth: unknown = handshake.auth?.token;
  if (typeof fromAuth === "string" && fromAuth.length > 0) return fromAuth;
  return readCookie(handshake.headers.cookie, PARTICIPANT_COOKIE);
}

// The presenter and the audience screen ask for `auth: { role: "host" }`. The role is asked
// for, not guessed, because a host who also joined as a student has both cookies.
export function wantsHostRole(handshake: Socket["handshake"]): boolean {
  return handshake.auth?.role === "host";
}

export function hostTokenFromHandshake(handshake: Socket["handshake"]): string | undefined {
  return readCookie(handshake.headers.cookie, SESSION_COOKIE);
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0 || part.slice(0, i).trim() !== name) continue;
    const value = part.slice(i + 1).trim();
    try {
      return decodeURIComponent(value) || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
