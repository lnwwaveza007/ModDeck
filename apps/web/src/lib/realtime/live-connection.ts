// Resume logic for live screens on top of the typed socket (MD-13):
//  - after every (re)connect it sends `join { sessionId, lastSeq }` and applies the `state` ack
//  - drops duplicate room events, and joins again to fill a gap in `seq`
//  - stops for good when the session ends or the server refuses the participant
//  - send() re-sends one answer with the same answerId until the server acks it, so a
//    lost ack never counts an answer twice (the server dedupes by answerId)
// Socket.IO's own reconnect (with backoff) brings the connection back.

import {
  ROOM_EVENT_TYPES,
  type AnswerAck,
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
  "SESSION_FULL", // the seat was freed after 15 min offline and the room filled up (MD-5 §6.5)
];

export interface SendOptions {
  /** Tries per answer, the first send included. */
  attempts?: number;
  /** Wait for each ack this long. */
  ackTimeoutMs?: number;
}

/** The answer could not be confirmed. It may or may not have counted: ask the student to look again. */
export class SendError extends Error {
  constructor(readonly reason: "ended" | "no_ack") {
    super(reason === "ended" ? "The session ended" : "The server did not confirm the answer");
  }
}

export class LiveConnection {
  private readonly socket: SessionSocket;
  private seq: number;
  private joined = false;
  private currentStatus: ConnectionStatus = "connecting";
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private onlineWaiters: { resolve: () => void; reject: (error: SendError) => void }[] = [];

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
    // The handshake refused us (token, ended session, full room). Socket.IO does not retry these.
    this.socket.on("connect_error", (error: Error & { data?: ErrorBody }) => {
      if (!error.data) return; // plain network failure: Socket.IO retries by itself
      this.options.onError?.(error.data);
      if (FINAL_ERRORS.includes(error.data.code)) return this.end();
      this.setStatus("reconnecting");
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => this.socket.connect(), this.options.retryMs ?? 2000);
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
    this.rejectWaiters();
    if (typeof window !== "undefined") {
      window.removeEventListener("offline", this.handleOffline);
      window.removeEventListener("online", this.handleOnline);
    }
    this.socket.removeAllListeners();
    this.socket.disconnect();
  }

  /**
   * Sends one answer (`vote`, `word`) and resolves with the server's ack. `payload.answerId`
   * is made once by the caller, and every retry here re-sends the same payload, so the
   * server counts the answer once. After a drop it waits to be online again first. It never
   * queues an answer for an offline student (MD-5 Q20): call it only while `status` is "online".
   */
  async send<R = unknown>(
    event: string,
    payload: { answerId: string } & Record<string, unknown>,
    { attempts = 3, ackTimeoutMs = 5000 }: SendOptions = {},
  ): Promise<AnswerAck<R>> {
    if (!this.joined) throw new SendError(this.currentStatus === "ended" ? "ended" : "no_ack");
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const reply = await this.emitOnce<R>(event, payload, ackTimeoutMs);
      if (reply) return reply;
      if (attempt < attempts) await this.untilOnline();
    }
    throw new SendError("no_ack");
  }

  // ----- internals -----

  private emitOnce<R>(
    event: string,
    payload: unknown,
    timeoutMs: number,
  ): Promise<AnswerAck<R> | undefined> {
    return new Promise((resolve) => {
      (
        this.socket.timeout(timeoutMs) as unknown as {
          emit: (
            event: string,
            payload: unknown,
            ack: (timeout: Error | null, reply: AnswerAck<R>) => void,
          ) => void;
        }
      ).emit(event, payload, (timeout, reply) => resolve(timeout ? undefined : reply));
    });
  }

  private untilOnline(): Promise<void> {
    if (this.joined) return Promise.resolve();
    if (this.currentStatus === "ended") return Promise.reject(new SendError("ended"));
    return new Promise((resolve, reject) => this.onlineWaiters.push({ resolve, reject }));
  }

  private rejectWaiters() {
    const waiters = this.onlineWaiters;
    this.onlineWaiters = [];
    for (const waiter of waiters) waiter.reject(new SendError("ended"));
  }

  private setStatus(status: ConnectionStatus) {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    if (status === "online") {
      const waiters = this.onlineWaiters;
      this.onlineWaiters = [];
      for (const waiter of waiters) waiter.resolve();
    }
    this.options.onStatus?.(status);
    if (status === "ended") this.rejectWaiters();
  }

  private handleOffline = () => {
    if (this.currentStatus !== "ended") this.setStatus("offline");
  };

  private handleOnline = () => {
    if (this.currentStatus === "ended") return;
    if (!this.socket.connected) {
      if (this.currentStatus === "offline") this.setStatus("reconnecting");
      this.socket.connect();
    } else if (this.joined) {
      // A short blip: the socket never dropped, so no `connect` will come to say we are back.
      this.setStatus("online");
    } else if (this.currentStatus === "offline") {
      this.setStatus("reconnecting"); // connected but not joined yet: the join ack brings us online
    }
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
      // The server is the source of truth. If its counter is behind ours (Redis lost its data in
      // a restart), keeping our higher number would make us ignore every new event as a duplicate.
      this.seq = state.seq;
      return;
    }
    for (const event of state.events) {
      if (event.seq > this.seq) {
        this.seq = event.seq;
        this.options.onEvent?.(event);
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
