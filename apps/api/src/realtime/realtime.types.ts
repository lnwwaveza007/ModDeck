import type { ClientToServerEvents, ServerToClientEvents } from "@moddeck/shared";
import type { Server, Socket } from "socket.io";
import type { SocketIdentity } from "./room-auth.service";

// Per-socket data, set by the handshake middleware in RealtimeGateway.
export interface SocketData {
  identity: SocketIdentity;
}

// No server-to-server events: instances only relay room broadcasts.
type InterServerEvents = Record<string, never>;

export type RealtimeServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export type RealtimeSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
