import type { ClientToServerEvents, ServerToClientEvents } from "@moddeck/shared";
import { io, type Socket } from "socket.io-client";

// Live channel to the api, typed with the event schema shared with the server
// (packages/shared). The participant token travels in its HttpOnly cookie.
export type SessionSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// Socket.IO reads a URL path as a namespace, so connect to the api's origin
// only. NEXT_PUBLIC_API_URL is "/api" behind nginx (same origin, /socket.io/
// proxied) and "http://localhost:4000" in local dev.
export function socketOrigin(
  apiUrl: string = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  base: string = window.location.href,
): string {
  return new URL(apiUrl, base).origin;
}

export function createSessionSocket(origin: string = socketOrigin()): SessionSocket {
  return io(origin, { withCredentials: true, autoConnect: false });
}
