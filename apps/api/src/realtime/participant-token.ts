import { createHash } from "node:crypto";
import { PARTICIPANT_COOKIE } from "@moddeck/shared";
import type { Socket } from "socket.io";

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
