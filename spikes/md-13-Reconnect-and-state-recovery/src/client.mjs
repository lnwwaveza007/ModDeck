import { io as ioClient } from "socket.io-client";
import { randomUUID } from "node:crypto";
import { serializeSessionCookie } from "./cookie.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Quiz client with automatic rejoin:
 *  - keeps the session token { userId, sessionId, lastSeq, loginType, token }
 *  - on any unexpected disconnect, retries with backoff + jitter, then sends `hello`
 *  - applies missed events / snapshot, then flushes queued answers (same answerId on every retry)
 */
export class QuizClient {
  constructor({ url, backoffMs = [100, 200, 400, 800, 1500], onEvent, onStatus } = {}) {
    this.url = url;
    this.backoffMs = backoffMs;
    this.onEvent = onEvent ?? (() => {});
    this.onStatus = onStatus ?? (() => {});
    this.socket = null;
    this.token = null; // { userId, sessionId, lastSeq, loginType, token }
    this.you = null;
    this.snapshot = null;
    this.pending = []; // [{ answerId, questionId, option, resolve }]
    this.connected = false;
    this.forcedOffline = false;
    this.closed = false;
    this.ended = false;
    this.reconnects = 0;
    this.lastResumeMode = null; // "replay" | "snapshot" (from the last hello); "snapshot" = event log was trimmed past our lastSeq
    this._looping = false;
  }

  get lastSeq() {
    return this.token?.lastSeq ?? 0;
  }

  /** The value a browser would keep in the session cookie. */
  cookie() {
    return this.token ? serializeSessionCookie(this.token) : null;
  }

  async join({ pin, nickname, loginType = "guest" }) {
    await this._open();
    const joined = await this._emit("join", { pin, nickname, loginType });
    if (!joined.ok) throw new Error(`join failed: ${joined.code}`);
    this.token = joined.token;
    this.you = joined.you;
    this.snapshot = joined.snapshot;
    this.connected = true;
    this.onStatus("connected");
    return joined;
  }

  /** Returns a promise that resolves with the server ack once the answer is delivered (maybe after a reconnect). */
  submitAnswer(questionId, option) {
    return new Promise((resolve) => {
      this.pending.push({ answerId: `a_${randomUUID()}`, questionId, option, resolve });
      this._flush().catch(() => {});
    });
  }

  /** Test helper: simulate WiFi off. No automatic reconnect until goOnline(). */
  goOffline() {
    this.forcedOffline = true;
    this.connected = false;
    this.socket?.disconnect();
    this.onStatus("offline");
  }

  goOnline() {
    this.forcedOffline = false;
    this._reconnectLoop();
  }

  close() {
    this.closed = true;
    this.socket?.close();
  }

  // ----- internals -----
  _open(timeoutMs = 1500) {
    this.socket?.removeAllListeners();
    this.socket?.close();
    const socket = ioClient(this.url, {
      transports: ["websocket"],
      reconnection: false,
      timeout: timeoutMs,
    });
    this.socket = socket;
    socket.on("event", (ev) => this._onEvent(ev));
    socket.on("disconnect", () => {
      if (this.socket !== socket) return;
      this.connected = false;
      this.onStatus("reconnecting");
      if (!this.forcedOffline && !this.closed && !this.ended) this._reconnectLoop();
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("connect timeout")), timeoutMs + 200);
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once("connect_error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  _emit(event, payload, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), timeoutMs);
      this.socket.emit(event, payload, (ack) => {
        clearTimeout(timer);
        resolve(ack);
      });
    });
  }

  _onEvent(ev) {
    if (!this.token) return; // still joining: the join ack carries the starting seq
    if (ev.seq <= this.lastSeq) return; // duplicate (already applied via replay)
    if (ev.seq > this.lastSeq + 1) {
      // gap: we missed something, ask the server to fill it in
      this._resync().catch(() => {});
      return;
    }
    this.token.lastSeq = ev.seq;
    this.onEvent(ev);
  }

  async _resync() {
    const sync = await this._emit("hello", { token: this.token.token, lastSeq: this.lastSeq });
    this._applySync(sync);
  }

  _applySync(sync) {
    if (!sync.ok) {
      // Token no longer valid or the session is over: forget everything (guest cleanup)
      this.ended = true;
      this.token = null;
      this.pending = [];
      this.onStatus(sync.code === "SESSION_ENDED" ? "ended" : "invalid");
      return;
    }
    this.lastResumeMode = sync.mode;
    this.you = sync.you;
    this.snapshot = sync.snapshot;
    for (const ev of sync.missed) {
      if (ev.seq > this.lastSeq) {
        this.token.lastSeq = ev.seq;
        this.onEvent(ev);
      }
    }
    this.token.lastSeq = sync.lastSeq;
  }

  async _reconnectLoop() {
    if (this._looping) return;
    this._looping = true;
    let attempt = 0;
    try {
      while (!this.closed && !this.ended && !this.connected && !this.forcedOffline) {
        try {
          await this._open();
          const sync = await this._emit("hello", {
            token: this.token.token,
            lastSeq: this.lastSeq,
          });
          this._applySync(sync);
          if (this.ended) return;
          this.connected = true;
          this.reconnects += 1;
          this.onStatus("connected");
          await this._flush();
          return;
        } catch {
          const base = this.backoffMs[Math.min(attempt, this.backoffMs.length - 1)];
          attempt += 1;
          await sleep(base + Math.random() * base * 0.25); // jitter
        }
      }
    } finally {
      this._looping = false;
    }
  }

  async _flush() {
    if (this._flushing || !this.connected) return;
    this._flushing = true;
    try {
      while (this.pending.length && this.connected) {
        const item = this.pending[0];
        let ack;
        try {
          ack = await this._emit("answer", {
            token: this.token.token,
            questionId: item.questionId,
            option: item.option,
            answerId: item.answerId, // same id on every retry
          });
        } catch {
          return; // connection lost mid-send: keep it queued, the reconnect loop will retry
        }
        // Remove from the queue only once the server answered (accepted, duplicate, or a final rejection)
        this.pending.shift();
        if (ack.ok && ack.accepted && this.you) {
          this.you.score = ack.score;
          this.you.answers[item.questionId] = {
            answerId: item.answerId,
            option: item.option,
            points: ack.points,
            correct: ack.correct,
          };
        }
        item.resolve(ack);
      }
    } finally {
      this._flushing = false;
    }
  }
}
