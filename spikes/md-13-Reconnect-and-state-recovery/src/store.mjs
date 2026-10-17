import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

const TEAMS = ["Red", "Blue", "Green"];
const COOKIE_NAME = "md13_session";
// Server-side token lifetime. The session cookie uses the same value, so the two can't drift apart.
const DEFAULT_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
// Max events kept per session. Older ones are dropped; clients that fell behind them resync from the snapshot.
const DEFAULT_MAX_EVENTS = 500;

export { COOKIE_NAME, TEAMS, DEFAULT_TOKEN_TTL_MS, DEFAULT_MAX_EVENTS };

function newId(bytes = 16) {
  return randomBytes(bytes).toString("hex");
}

function emptyState() {
  return {
    sessions: {},
    pinToSession: {},
    tokens: {},
  };
}

export class Store {
  constructor({
    filePath,
    tokenTtlMs = DEFAULT_TOKEN_TTL_MS,
    maxEvents = DEFAULT_MAX_EVENTS,
    now = Date.now,
  } = {}) {
    this.filePath = filePath;
    this.tokenTtlMs = tokenTtlMs;
    this.maxEvents = maxEvents;
    this.now = now; // injectable clock (tests)
    this.state = emptyState();
    // Write coalescing. `version` counts changes; `flushedVersion` is the newest change known to be on disk.
    this.version = 0;
    this.flushedVersion = 0;
    this.writeCount = 0; // completed file writes (stats / tests)
    this._running = false; // is the single writer loop active?
    this._waiters = []; // [{ version, resolve, reject }] callers waiting for durability
  }

  async load() {
    if (!this.filePath) return;
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.state = {
        sessions: parsed.sessions ?? {},
        pinToSession: parsed.pinToSession ?? {},
        tokens: parsed.tokens ?? {},
      };
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      this.state = emptyState();
    }
    // Migrate state written before expiry existed: legacy tokens get a fresh full lifetime.
    for (const rec of Object.values(this.state.tokens)) {
      if (rec.expiresAt == null) rec.expiresAt = this.now() + this.tokenTtlMs;
    }
    // Shrink logs written before the cap existed.
    let changed = false;
    for (const session of Object.values(this.state.sessions)) {
      if (session.events.length > this.maxEvents) {
        session.events.splice(0, session.events.length - this.maxEvents);
        changed = true;
      }
    }
    if (this.pruneExpiredTokens() > 0 || changed) this.persistSoon();
  }

  /** Drops expired tokens. Participants (and their scores) stay in the session. Returns how many were removed. */
  pruneExpiredTokens() {
    const t = this.now();
    let removed = 0;
    for (const [key, rec] of Object.entries(this.state.tokens)) {
      if (!(rec.expiresAt > t)) {
        delete this.state.tokens[key];
        removed += 1;
      }
    }
    return removed;
  }

  /** Sliding expiry: extend once less than half the lifetime is left (avoids a disk write on every call). */
  touchToken(rec) {
    const t = this.now();
    if (rec.expiresAt - t < this.tokenTtlMs / 2) {
      rec.expiresAt = t + this.tokenTtlMs;
      this.persistSoon();
    }
  }

  /**
   * Marks the state as changed. Cheap: it never writes by itself.
   * Changes made while a write is in flight are picked up together by ONE trailing write,
   * so N changes cost a handful of file writes instead of N.
   */
  persistSoon() {
    if (!this.filePath) return;
    this.version += 1;
    this._kick();
  }

  /**
   * Resolves once every change made up to now is on disk (rejects if the write failed).
   * Await it after a mutation and before acknowledging to a client: "acked" then means "durable".
   */
  get writing() {
    return this.whenDurable();
  }

  whenDurable() {
    if (!this.filePath || this.flushedVersion >= this.version) return Promise.resolve();
    const promise = new Promise((resolve, reject) => {
      this._waiters.push({ version: this.version, resolve, reject });
    });
    this._kick(); // also retries after an earlier failed write
    return promise;
  }

  /** Forces a write now (even if nothing changed) and waits for it. */
  flush() {
    if (!this.filePath) return Promise.resolve();
    this.version += 1;
    return this.whenDurable();
  }

  _kick() {
    if (this._running) return;
    this._running = true; // set synchronously so a second caller can never start a second writer
    this._run();
  }

  async _run() {
    try {
      while (this.flushedVersion < this.version) {
        const covered = this.version;
        try {
          // Serialised synchronously, so this snapshot contains every change up to `covered`.
          const data = JSON.stringify(this.state);
          await this._writeData(data);
        } catch (err) {
          console.error("store: failed to write state file:", err);
          this._settle(null, err);
          return; // flushedVersion stays behind; the next persistSoon()/whenDurable() retries
        }
        this.flushedVersion = covered;
        this.writeCount += 1;
        this._settle(covered, null);
      }
    } finally {
      this._running = false; // cleared in the same tick the loop ends: no window where a change is missed
    }
  }

  _settle(coveredVersion, err) {
    const pending = [];
    for (const w of this._waiters) {
      if (err) w.reject(err);
      else if (w.version <= coveredVersion) w.resolve();
      else pending.push(w);
    }
    this._waiters = pending;
  }

  async _writeData(data) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, data, "utf8");
    await rename(tmp, this.filePath); // atomic: readers never see a half-written file
  }

  createSession({ pin } = {}) {
    const sessionId = randomUUID();
    const roomPin =
      pin && /^\d{6}$/.test(String(pin))
        ? String(pin)
        : String(100000 + Math.floor(Math.random() * 900000));
    if (this.state.pinToSession[roomPin]) {
      throw Object.assign(new Error("PIN already in use"), { code: "PIN_IN_USE" });
    }
    this.state.sessions[sessionId] = {
      sessionId,
      pin: roomPin,
      seq: 0,
      status: "live",
      question: null,
      questionIndex: 0,
      events: [],
      participants: {},
      answerIds: {},
      tally: {},
      createdAt: this.now(),
    };
    this.state.pinToSession[roomPin] = sessionId;
    this.persistSoon();
    return this.state.sessions[sessionId];
  }

  getSession(sessionId) {
    return this.state.sessions[sessionId] ?? null;
  }

  getSessionByPin(pin) {
    const sessionId = this.state.pinToSession[String(pin)];
    return sessionId ? this.state.sessions[sessionId] : null;
  }

  resolveToken(token) {
    if (!token) return null;
    const rec = this.state.tokens[token];
    if (!rec) return null;
    if (!(rec.expiresAt > this.now())) return null; // expired (missing expiresAt fails closed)
    const session = this.state.sessions[rec.sessionId];
    if (!session) return null;
    const participant = session.participants[rec.userId];
    if (!participant) return null;
    return { rec, session, participant };
  }

  join({ pin, nickname, loginType = "guest", existingToken } = {}) {
    const session = this.getSessionByPin(pin);
    if (!session) {
      throw Object.assign(new Error("Unknown PIN"), { code: "UNKNOWN_PIN" });
    }
    if (session.status !== "live") {
      throw Object.assign(new Error("Session has ended"), { code: "SESSION_ENDED" });
    }

    this.pruneExpiredTokens();
    const existing = existingToken ? this.resolveToken(existingToken) : null;
    if (existing && existing.session.sessionId === session.sessionId) {
      this.touchToken(existing.rec);
      return {
        token: existingToken,
        userId: existing.rec.userId,
        sessionId: session.sessionId,
        loginType: existing.rec.loginType,
        participant: existing.participant,
        resumed: true,
      };
    }

    const userId = randomUUID();
    const token = newId();
    const team = TEAMS[Object.keys(session.participants).length % TEAMS.length];
    const participant = {
      userId,
      nickname: String(nickname || `Guest-${userId.slice(0, 4)}`).slice(0, 40),
      team,
      score: 0,
      loginType: loginType === "sso" ? "sso" : "guest",
      answers: {},
      joinedAt: this.now(),
    };
    session.participants[userId] = participant;
    this.state.tokens[token] = {
      token,
      userId,
      sessionId: session.sessionId,
      loginType: participant.loginType,
      expiresAt: this.now() + this.tokenTtlMs,
    };
    this.appendEvent(session, "participant_joined", {
      userId,
      nickname: participant.nickname,
      team,
    });
    this.persistSoon();
    return {
      token,
      userId,
      sessionId: session.sessionId,
      loginType: participant.loginType,
      participant,
      resumed: false,
    };
  }

  appendEvent(session, type, payload) {
    session.seq += 1;
    const event = { seq: session.seq, type, at: this.now(), payload };
    session.events.push(event);
    if (session.events.length > this.maxEvents) {
      session.events.splice(0, session.events.length - this.maxEvents);
    }
    this.persistSoon();
    return event;
  }

  snapshot(session) {
    return {
      sessionId: session.sessionId,
      pin: session.pin,
      status: session.status,
      seq: session.seq,
      question: session.question,
      questionIndex: session.questionIndex,
      tally: session.tally,
      participantCount: Object.keys(session.participants).length,
    };
  }

  you(participant) {
    return {
      userId: participant.userId,
      nickname: participant.nickname,
      team: participant.team,
      score: participant.score,
      loginType: participant.loginType,
      answers: participant.answers,
    };
  }

  missedEvents(session, lastSeq) {
    const from = Number.isFinite(lastSeq) ? lastSeq : 0;
    return session.events.filter((e) => e.seq > from);
  }

  /**
   * "replay"   : every event after lastSeq is still in the log, so the client can apply them in order.
   * "snapshot" : the log was trimmed past lastSeq; the client must rebuild from the snapshot/you state instead.
   */
  resumeMode(session, lastSeq) {
    const from = Number.isFinite(lastSeq) ? lastSeq : 0;
    const oldest = session.events[0]?.seq;
    return oldest !== undefined && from + 1 < oldest ? "snapshot" : "replay";
  }

  sync({ token, lastSeq }) {
    const resolved = this.resolveToken(token);
    if (!resolved) {
      throw Object.assign(new Error("Unknown or expired session token"), { code: "INVALID_TOKEN" });
    }
    const { session, participant, rec } = resolved;
    this.touchToken(rec);
    return {
      userId: rec.userId,
      sessionId: session.sessionId,
      loginType: rec.loginType,
      mode: this.resumeMode(session, lastSeq),
      lastSeq: session.seq,
      snapshot: this.snapshot(session),
      you: this.you(participant),
      missed: this.missedEvents(session, lastSeq),
    };
  }

  showQuestion(sessionId, { text, options } = {}) {
    const session = this.getSession(sessionId);
    if (!session) throw Object.assign(new Error("Unknown session"), { code: "UNKNOWN_SESSION" });
    if (session.status !== "live") {
      throw Object.assign(new Error("Session has ended"), { code: "SESSION_ENDED" });
    }
    session.questionIndex += 1;
    const question = {
      id: `q${session.questionIndex}`,
      text: String(text || `Question ${session.questionIndex}`).slice(0, 500),
      options:
        Array.isArray(options) && options.length
          ? options.map((o) => String(o).slice(0, 80))
          : ["A", "B", "C", "D"],
      index: session.questionIndex,
    };
    session.question = question;
    session.tally = Object.fromEntries(question.options.map((o) => [o, 0]));
    const event = this.appendEvent(session, "question_shown", { question, tally: session.tally });
    this.persistSoon();
    return { question, event };
  }

  submitAnswer({ token, questionId, option, answerId }) {
    const resolved = this.resolveToken(token);
    if (!resolved) {
      throw Object.assign(new Error("Unknown or expired session token"), { code: "INVALID_TOKEN" });
    }
    const { session, participant, rec } = resolved;
    this.touchToken(rec);
    if (session.status !== "live") {
      throw Object.assign(new Error("Session has ended"), { code: "SESSION_ENDED" });
    }
    if (answerId && typeof answerId === "string") {
      const prior = session.answerIds[answerId];
      if (prior && prior.userId === participant.userId) {
        return {
          duplicate: true,
          accepted: false,
          ...this.answerResult(participant, prior.questionId),
          score: participant.score,
          team: participant.team,
          tally: session.tally,
          answers: participant.answers,
          event: null,
        };
      }
    }
    if (!session.question || session.question.id !== questionId) {
      throw Object.assign(new Error("Question is not active"), { code: "QUESTION_CLOSED" });
    }
    if (!session.question.options.includes(option)) {
      throw Object.assign(new Error("Invalid option"), { code: "INVALID_OPTION" });
    }
    if (!answerId || typeof answerId !== "string") {
      throw Object.assign(new Error("answerId is required"), { code: "MISSING_ANSWER_ID" });
    }

    const already = participant.answers[questionId];
    if (already) {
      return {
        duplicate: true,
        accepted: false,
        ...this.answerResult(participant, questionId),
        score: participant.score,
        team: participant.team,
        tally: session.tally,
        answers: participant.answers,
        event: null,
      };
    }

    const correct = session.question.options[0];
    const points = option === correct ? 100 : 0;
    participant.answers[questionId] = { answerId, option, points };
    participant.score += points;
    session.tally[option] = (session.tally[option] ?? 0) + 1;
    session.answerIds[answerId] = { userId: participant.userId, questionId, option };
    const event = this.appendEvent(session, "answer_accepted", {
      userId: participant.userId,
      questionId,
      option,
      tally: { ...session.tally },
      team: participant.team,
      score: participant.score,
    });
    this.persistSoon();
    return {
      duplicate: false,
      accepted: true,
      ...this.answerResult(participant, questionId),
      score: participant.score,
      team: participant.team,
      tally: session.tally,
      answers: participant.answers,
      event,
    };
  }

  /** What the participant's recorded answer for a question scored (used in every answer ack). */
  answerResult(participant, questionId) {
    const points = participant.answers[questionId]?.points ?? 0;
    return { points, correct: points > 0 };
  }

  endSession(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) throw Object.assign(new Error("Unknown session"), { code: "UNKNOWN_SESSION" });
    session.status = "ended";
    session.question = null;
    const event = this.appendEvent(session, "session_ended", { sessionId });
    this.persistSoon();
    return { session, event };
  }

  clientToken({ token, lastSeq }) {
    const resolved = this.resolveToken(token);
    if (!resolved) return null;
    return {
      token,
      userId: resolved.rec.userId,
      sessionId: resolved.session.sessionId,
      lastSeq: Number.isFinite(lastSeq) ? lastSeq : resolved.session.seq,
      loginType: resolved.rec.loginType,
    };
  }
}
