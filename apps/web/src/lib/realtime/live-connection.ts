// Resume logic for live screens on top of the typed socket (MD-13):
//  - after every (re)connect it sends `join { sessionId, lastSeq }` and applies the `state` ack
//  - drops duplicate room events, and joins again to fill a gap in `seq`
//  - stops for good when the session ends or the server refuses the participant
// Socket.IO's own reconnect (with backoff) brings the connection back.

import {
  ROOM_EVENT_TYPES,
  type ErrorBody,
  type ErrorCode,
  type JoinAck,
  type RoomEvent,
  type SessionSnapshot,
  type StatePayload,
} from "@moddeck/shared";
import { createSessionSocket, type SessionSocket } from "./socket";

export type ConnectionStatus = "connecting" | "online" | "reconnecting" | "offline" | "ended";

export interface LiveConnectionOptions {
  sessionId: string;
  /** Resume point, for example after a page reload. */
  lastSeq?: number;
  joinTimeoutMs?: number;
  retryMs?: number;
  onEvent?: (event: RoomEvent) => void;
  /** The server sent the whole state: first join, or our lastSeq fell out of the replay log. */
  onSnapshot?: (snapshot: SessionSnapshot) => void;
  onStatus?: (status: ConnectionStatus) => void;
  onError?: (error: ErrorBody) => void;
  /** Injected in tests. */
  socket?: SessionSocket;
}

/** Joining again cannot fix these. */
const FINAL_ERRORS: readonly ErrorCode[] = [
  "SESSION_ENDED",
  "PARTICIPANT_REMOVED",
  "ROOM_FORBIDDEN",
  "UNAUTHORIZED",
  "TOKEN_EXPIRED",
];

export class LiveConnection {
  private readonly socket: SessionSocket;
  private seq: number;
  private joined = false;
  private currentStatus: ConnectionStatus = "connecting";
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: LiveConnectionOptions) {
    this.socket = options.socket ?? createSessionSocket();
    this.seq = options.lastSeq ?? 0;
  }

  get status(): ConnectionStatus {
    return this.currentStatus;
  }

  get lastSeq(): number {
    return this.seq;
  }

  connect(): void {
    this.socket.on("connect", () => this.join());
    this.socket.on("disconnect", (reason) => {
      this.joined = false;
      if (this.currentStatus === "ended") return;
      this.setStatus(isOffline() ? "offline" : "reconnecting");
      // A server-side disconnect turns off auto reconnect; anything else retries by itself.
      if (reason === "io server disconnect") this.socket.connect();
    });
    this.socket.on("error", (error) => {
      this.options.onError?.(error);
      if (FINAL_ERRORS.includes(error.code)) this.end();
    });
    const onRoomEvent = (event: RoomEvent) => this.receive(event);
    for (const type of ROOM_EVENT_TYPES) {
      (this.socket.on as (type: string, listener: (event: RoomEvent) => void) => void)(
        type,
        onRoomEvent,
      );
    }
    if (typeof window !== "undefined") {
      window.addEventListener("offline", this.handleOffline);
      window.addEventListener("online", this.handleOnline);
    }
    this.socket.connect();
  }

  close(): void {
    clearTimeout(this.retryTimer);
    if (typeof window !== "undefined") {
      window.removeEventListener("offline", this.handleOffline);
      window.removeEventListener("online", this.handleOnline);
    }
    this.socket.removeAllListeners();
    this.socket.disconnect();
  }

  // ----- internals -----

  private setStatus(status: ConnectionStatus) {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    this.options.onStatus?.(status);
  }

  private handleOffline = () => {
    if (this.currentStatus !== "ended") this.setStatus("offline");
  };

  private handleOnline = () => {
    if (this.currentStatus === "offline") this.setStatus("reconnecting");
    if (!this.socket.connected && this.currentStatus !== "ended") this.socket.connect();
  };

  private join() {
    clearTimeout(this.retryTimer);
    const payload = {
      sessionId: this.options.sessionId,
      ...(this.seq ? { lastSeq: this.seq } : {}),
    };
    this.socket
      .timeout(this.options.joinTimeoutMs ?? 5000)
      .emit("join", payload, (timeout: Error | null, ack: JoinAck) => {
        if (this.currentStatus === "ended") return;
        if (timeout) return this.retryJoin();
        if (!ack.ok) {
          this.options.onError?.(ack.error);
          return FINAL_ERRORS.includes(ack.error.code) ? this.end() : this.retryJoin();
        }
        this.applyState(ack);
        this.joined = true;
        this.setStatus("online");
      });
  }

  private retryJoin() {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      if (this.socket.connected) this.join();
    }, this.options.retryMs ?? 2000);
  }

  private applyState(state: StatePayload) {
    if (state.mode === "snapshot") {
      this.options.onSnapshot?.(state.snapshot);
    } else {
      for (const event of state.events) {
        if (event.seq > this.seq) {
          this.seq = event.seq;
          this.options.onEvent?.(event);
        }
      }
    }
    this.seq = Math.max(this.seq, state.seq);
  }

  private receive(event: RoomEvent) {
    if (!this.joined) return; // the join ack covers anything sent before it
    if (event.seq <= this.seq) return; // duplicate, already applied
    if (event.seq > this.seq + 1) {
      this.joined = false;
      this.join(); // gap: ask the server to replay what we missed
      return;
    }
    this.seq = event.seq;
    this.options.onEvent?.(event);
    if (event.type === "session_ended") this.end();
  }

  private end() {
    clearTimeout(this.retryTimer);
    this.joined = false;
    this.setStatus("ended");
    this.socket.disconnect();
  }
}

function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}
