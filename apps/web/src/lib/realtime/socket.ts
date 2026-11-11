import type { ClientToServerEvents, ServerToClientEvents } from "@moddeck/shared";
import { io, type Socket } from "socket.io-client";

// Live channel to the api, typed with the event schema shared with the server
// (packages/shared). The participant token travels in its HttpOnly cookie.
export type SessionSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** "host": presenter control and the audience screen, signed in with the host login cookie. */
export type SocketRole = "participant" | "host";

// Socket.IO reads a URL path as a namespace, so connect to the api's origin
// only. NEXT_PUBLIC_API_URL is "/api" behind nginx (same origin, /socket.io/
// proxied) and "http://localhost:4000" in local dev.
export function socketOrigin(
  apiUrl: string = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  base: string = window.location.href,
): string {
  return new URL(apiUrl, base).origin;
}

// Socket.IO's HTTP path sits next to the api root: "/socket.io" at the site root,
// "/capstone26/cp26ssa2/socket.io" when the app is mounted under a prefix.
export function socketPath(
  apiUrl: string = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  base: string = window.location.href,
): string {
  const root = new URL(apiUrl, base).pathname.replace(/\/+$/, "").replace(/\/api$/, "");
  return `${root}/socket.io`;
}

export function createSessionSocket(
  origin: string = socketOrigin(),
  role: SocketRole = "participant",
  path: string = socketPath(),
): SessionSocket {
  return io(origin, {
    path,
    withCredentials: true,
    autoConnect: false,
    ...(role === "host" ? { auth: { role } } : {}),
  });
}
