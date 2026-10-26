// Browser Socket.IO wrapper for live screens. Ported from the MD-13 QuizClient:
//  - after every (re)connect it sends `hello { lastSeq }` and applies the `sync` ack
//  - drops duplicate events, and asks for a resync when it sees a gap in `seq`
//  - queues actions while disconnected and resends them after reconnect with the same ids
//  - reconnects with backoff + jitter (Socket.IO's own reconnect is off so hello always runs)

import { io, type ManagerOptions, type Socket, type SocketOptions } from "socket.io-client";
import {
  SERVER_EVENTS,
  type Ack,
  type AckedClientEventName,
  type ClientEventMap,
  type ServerEvent,
  type SocketErrorPayload,
  type SyncResult,
} from "./events";

export type ConnectionStatus = "connecting" | "online" | "reconnecting" | "offline" | "ended";

export type CreateSocket = (
  url: string | undefined,
  options: Partial<ManagerOptions & SocketOptions>,
) => Socket;

export interface SessionSocketOptions {
  /** API origin. Defaults to NEXT_PUBLIC_API_URL, else the page's own origin (nginx proxies /socket.io/). */
  url?: string;
  /** Resume point, for example after a page reload. */
  lastSeq?: number;
  backoffMs?: number[];
  connectTimeoutMs?: number;
  ackTimeoutMs?: number;
  onEvent?: (event: ServerEvent) => void;
  onSync?: (sync: Extract<SyncResult, { ok: true }>) => void;
  onStatus?: (status: ConnectionStatus) => void;
  onError?: (error: SocketErrorPayload) => void;
  /** Injected in tests. */
  createSocket?: CreateSocket;
}

interface PendingSend {
  event: AckedClientEventName;
  payload: unknown;
  resolve: (ack: Ack) => void;
  reject: (error: Error) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Client-made id for votes and words. The same id is reused on every retry (server dedups). */
export const newClientId = (prefix = "a") => `${prefix}_${crypto.randomUUID()}`;

export class SessionSocket {
  private socket: Socket | null = null;
  private seq: number;
  private pending: PendingSend[] = [];
  private connected = false;
  private closed = false;
  private flushing = false;
  private looping = false;
  private currentStatus: ConnectionStatus = "connecting";
  private readonly backoffMs: number[];
  private readonly connectTimeoutMs: number;
  private readonly ackTimeoutMs: number;
  private readonly createSocket: CreateSocket;

  constructor(private readonly options: SessionSocketOptions = {}) {
    this.seq = options.lastSeq ?? 0;
    this.backoffMs = options.backoffMs ?? [250, 500, 1000, 2000, 4000];
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5000;
    this.ackTimeoutMs = options.ackTimeoutMs ?? 5000;
    this.createSocket = options.createSocket ?? io;
  }

  get status(): ConnectionStatus {
    return this.currentStatus;
  }

  get lastSeq(): number {
    return this.seq;
  }

  /** Opens the connection and keeps it open until close() or the session ends. */
  connect(): void {
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleOnline);
      window.addEventListener("offline", this.handleOffline);
    }
    void this.reconnectLoop();
  }

  /**
   * Sends an action and resolves with the server ack. While offline the action waits in a
   * queue and is sent after reconnect, with the same payload (so the same answerId).
   */
  send<E extends AckedClientEventName>(event: E, payload: ClientEventMap[E]): Promise<Ack> {
    if (this.closed || this.currentStatus === "ended") {
      return Promise.reject(new Error(`SessionSocket is ${this.closed ? "closed" : "ended"}`));
    }
    return new Promise((resolve, reject) => {
      this.pending.push({ event, payload, resolve, reject });
      void this.flush();
    });
  }

  /** Fire and forget (reactions). Dropped while offline: a late emoji is noise. */
  sendVolatile(event: "reaction", payload: ClientEventMap["reaction"]): void {
    if (this.connected) this.socket?.emit(event, payload);
  }

  close(): void {
    this.closed = true;
    this.connected = false;
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.handleOnline);
      window.removeEventListener("offline", this.handleOffline);
    }
    this.socket?.removeAllListeners();
    this.socket?.close();
    this.rejectPending(new Error("SessionSocket closed"));
  }

  // ----- internals -----

  private setStatus(status: ConnectionStatus) {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    this.options.onStatus?.(status);
  }

  private get stopped() {
    return this.closed || this.currentStatus === "ended";
  }

  private handleOnline = () => {
    if (!this.connected && !this.stopped) {
      this.setStatus("reconnecting");
      void this.reconnectLoop();
    }
  };

  private handleOffline = () => {
    if (!this.stopped) this.setStatus("offline");
  };

  private open(): Promise<void> {
    this.socket?.removeAllListeners();
    this.socket?.close();

    const socket = this.createSocket(this.options.url ?? process.env.NEXT_PUBLIC_API_URL, {
      withCredentials: true,
      reconnection: false,
      timeout: this.connectTimeoutMs,
    });
    this.socket = socket;

    for (const name of SERVER_EVENTS) {
      socket.on(name, (data: { seq: number }) => {
        const { seq, ...payload } = data;
        this.receive({ name, seq, payload } as ServerEvent);
      });
    }
    socket.on("error", (error: SocketErrorPayload) => this.options.onError?.(error));
    socket.on("disconnect", () => {
      if (this.socket !== socket) return;
      this.connected = false;
      if (this.stopped) return;
      this.setStatus(
        typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "reconnecting",
      );
      void this.reconnectLoop();
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("connect timeout")),
        this.connectTimeoutMs + 200,
      );
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once("connect_error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  private emitWithAck<T>(event: string, payload: unknown): Promise<T> {
    const socket = this.socket;
    if (!socket) return Promise.reject(new Error("not connected"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), this.ackTimeoutMs);
      socket.emit(event, payload, (ack: T) => {
        clearTimeout(timer);
        resolve(ack);
      });
    });
  }

  private receive(event: ServerEvent) {
    if (event.seq <= this.seq) return; // duplicate, already applied (for example from a replay)
    if (event.seq > this.seq + 1) {
      void this.hello().catch(() => {}); // gap: let the server fill it in
      return;
    }
    this.seq = event.seq;
    this.options.onEvent?.(event);
    if (event.name === "session_ended") this.end();
  }

  private async hello() {
    const sync = await this.emitWithAck<SyncResult>("hello", { lastSeq: this.seq });
    this.applySync(sync);
  }

  private applySync(sync: SyncResult) {
    if (!sync.ok) {
      this.end();
      return;
    }
    for (const event of sync.events ?? []) {
      if (event.seq > this.seq) {
        this.seq = event.seq;
        this.options.onEvent?.(event);
      }
    }
    this.seq = Math.max(this.seq, sync.lastSeq);
    this.options.onSync?.(sync);
  }

  private end() {
    this.connected = false;
    this.setStatus("ended");
    this.socket?.removeAllListeners();
    this.socket?.close();
    this.rejectPending(new Error("Session ended"));
  }

  private rejectPending(error: Error) {
    const pending = this.pending;
    this.pending = [];
    for (const item of pending) item.reject(error);
  }

  private async reconnectLoop() {
    if (this.looping) return;
    this.looping = true;
    let attempt = 0;
    try {
      while (!this.stopped && !this.connected) {
        try {
          await this.open();
          await this.hello();
          if (this.stopped) return;
          this.connected = true;
          this.setStatus("online");
          await this.flush();
          return;
        } catch {
          const base = this.backoffMs[Math.min(attempt, this.backoffMs.length - 1)];
          attempt += 1;
          await sleep(base + Math.random() * base * 0.25); // jitter
        }
      }
    } finally {
      this.looping = false;
    }
  }

  private async flush() {
    if (this.flushing || !this.connected) return;
    this.flushing = true;
    try {
      while (this.pending.length && this.connected) {
        const item = this.pending[0];
        let ack: Ack;
        try {
          ack = await this.emitWithAck<Ack>(item.event, item.payload);
        } catch {
          return; // lost mid-send: keep it queued, the reconnect loop sends it again
        }
        // Leave the queue only once the server answered (accepted, duplicate or rejected).
        this.pending.shift();
        item.resolve(ack);
      }
    } finally {
      this.flushing = false;
    }
  }
}
