import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { Store } from "./store.mjs";
import { readSessionCookie, serializeSessionCookie, shouldClearCookie } from "./cookie.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = Number(process.env.PORT ?? 4013);
const DEFAULT_STATE = process.env.STATE_FILE ?? join(__dirname, "..", "data", "state.json");

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": "true",
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

function errorPayload(err) {
  return { ok: false, code: err.code ?? "ERROR", message: err.message };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export async function createApp({
  port = DEFAULT_PORT,
  stateFile = DEFAULT_STATE,
  storeOptions = {},
} = {}) {
  const store = new Store({ filePath: stateFile, ...storeOptions });
  await store.load();

  const publicFile = join(__dirname, "..", "public", "index.html");

  function cookieHeaderFor(token, lastSeq, { ended = false } = {}) {
    const payload = store.clientToken({ token, lastSeq });
    if (!payload) return serializeSessionCookie(null, { clear: true });
    if (ended && shouldClearCookie(payload)) {
      return serializeSessionCookie(null, { clear: true });
    }
    // cookie lifetime follows the server-side token lifetime
    return serializeSessionCookie(payload, { maxAge: Math.floor(store.tokenTtlMs / 1000) });
  }

  function emitRoomEvent(io, session, event) {
    io.to(session.sessionId).emit("event", event);
  }

  const httpServer = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Cookie",
          "Access-Control-Allow-Credentials": "true",
        });
        res.end();
        return;
      }

      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        const html = await readFile(publicFile, "utf8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        json(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/sessions") {
        const body = await readBody(req);
        const session = store.createSession({ pin: body.pin });
        await store.writing;
        json(res, 201, { ok: true, sessionId: session.sessionId, pin: session.pin });
        return;
      }

      const questionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/questions$/);
      if (req.method === "POST" && questionMatch) {
        const body = await readBody(req);
        const session = store.getSession(questionMatch[1]);
        const { question, event } = store.showQuestion(questionMatch[1], body);
        await store.writing;
        emitRoomEvent(io, session, event);
        json(res, 201, { ok: true, question, seq: event.seq });
        return;
      }

      const endMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/end$/);
      if (req.method === "POST" && endMatch) {
        const cookie = readSessionCookie(req.headers.cookie);
        const { session, event } = store.endSession(endMatch[1]);
        await store.writing;
        emitRoomEvent(io, session, event);
        io.to(session.sessionId).emit("session_ended", {
          sessionId: session.sessionId,
          clearGuestCookie: true,
        });
        json(
          res,
          200,
          { ok: true, status: session.status },
          {
            "Set-Cookie": cookieHeaderFor(cookie?.token, cookie?.lastSeq, { ended: true }),
          },
        );
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/me") {
        const cookie = readSessionCookie(req.headers.cookie);
        if (!cookie) {
          json(res, 401, { ok: false, code: "NO_COOKIE" });
          return;
        }
        const sync = store.sync({ token: cookie.token, lastSeq: cookie.lastSeq ?? 0 });
        json(
          res,
          200,
          { ok: true, ...sync, cookie },
          {
            "Set-Cookie": cookieHeaderFor(cookie.token, sync.lastSeq),
          },
        );
        return;
      }

      json(res, 404, { ok: false, code: "NOT_FOUND" });
    } catch (err) {
      const status = err.code === "UNKNOWN_PIN" || err.code === "UNKNOWN_SESSION" ? 404 : 400;
      json(res, status, errorPayload(err));
    }
  });

  const io = new Server(httpServer, {
    cors: { origin: "*", credentials: true },
  });

  function ackError(err) {
    return { ok: false, code: err.code ?? "ERROR", message: err.message };
  }

  io.on("connection", (socket) => {
    const handshakeCookie = readSessionCookie(socket.handshake.headers.cookie);

    socket.on("join", async (payload = {}, ack) => {
      try {
        const cookie = readSessionCookie(socket.handshake.headers.cookie) ?? handshakeCookie;
        const result = store.join({
          pin: payload.pin,
          nickname: payload.nickname,
          loginType: payload.loginType === "sso" ? "sso" : "guest",
          existingToken: payload.token ?? cookie?.token,
        });
        await store.writing;
        socket.data.token = result.token;
        socket.data.sessionId = result.sessionId;
        socket.join(result.sessionId);
        const session = store.getSession(result.sessionId);
        const sync = store.sync({ token: result.token, lastSeq: 0 });
        const clientToken = store.clientToken({ token: result.token, lastSeq: session.seq });
        const reply = {
          ok: true,
          resumed: result.resumed,
          cookieName: "md13_session",
          ...sync,
          token: clientToken,
        };
        socket.emit("joined", reply);
        ack?.(reply);
      } catch (err) {
        const reply = ackError(err);
        socket.emit("error_event", reply);
        ack?.(reply);
      }
    });

    socket.on("hello", (payload = {}, ack) => {
      try {
        const cookie = readSessionCookie(socket.handshake.headers.cookie) ?? handshakeCookie;
        const token = payload.token ?? cookie?.token;
        const lastSeq = payload.lastSeq ?? cookie?.lastSeq ?? 0;
        const sync = store.sync({ token, lastSeq });
        if (sync.snapshot.status !== "live") {
          const ended = {
            ok: false,
            code: "SESSION_ENDED",
            message: "Session has ended",
            clearGuestCookie: sync.loginType === "guest",
          };
          ack?.(ended);
          socket.emit("session_ended", ended);
          return;
        }
        socket.data.token = token;
        socket.data.sessionId = sync.sessionId;
        socket.join(sync.sessionId);
        const reply = {
          ok: true,
          ...sync,
          token: store.clientToken({ token, lastSeq: sync.lastSeq }),
        };
        socket.emit("sync", reply);
        ack?.(reply);
      } catch (err) {
        const reply = ackError(err);
        socket.emit("error_event", reply);
        ack?.(reply);
      }
    });

    socket.on("answer", async (payload = {}, ack) => {
      try {
        const cookie = readSessionCookie(socket.handshake.headers.cookie) ?? handshakeCookie;
        const token = payload.token ?? socket.data.token ?? cookie?.token;
        const result = store.submitAnswer({
          token,
          questionId: payload.questionId,
          option: payload.option,
          answerId: payload.answerId,
        });
        await store.writing;
        const session = store.resolveToken(token).session;
        if (result.event) emitRoomEvent(io, session, result.event);
        const reply = {
          ok: true,
          duplicate: result.duplicate,
          accepted: result.accepted,
          correct: result.correct,
          points: result.points,
          score: result.score,
          team: result.team,
          tally: result.tally,
          answers: result.answers,
          lastSeq: session.seq,
        };
        ack?.(reply);
      } catch (err) {
        ack?.(ackError(err));
      }
    });
  });

  await new Promise((resolve) => httpServer.listen(port, resolve));

  async function close() {
    await store.writing;
    await store.flush();
    await new Promise((resolve) => io.close(resolve));
    await new Promise((resolve) => {
      httpServer.close(() => resolve());
    });
  }

  return { httpServer, io, store, port, close };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const app = await createApp();
  console.log(`MD-13 spike listening on http://localhost:${app.port}`);
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
      await app.close();
      process.exit(0);
    });
  }
}
