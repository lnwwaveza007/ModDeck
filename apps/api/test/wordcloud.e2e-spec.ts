// Word cloud end to end: the host runs a word cloud, students send words over the socket, and the
// cloud reaches every screen. Real Postgres and Redis; two api instances behind one Redis.

import { randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  PARTICIPANT_COOKIE,
  VOTE_BATCH_MS,
  WORD_MAX_LENGTH,
  type AnswerAck,
  type ClientToServerEvents,
  type JoinAck,
  type LiveSessionView,
  type ParticipantMe,
  type RoomEvent,
  type RoomEventType,
  type ServerToClientEvents,
  type WordResult,
  type WordVisibilityResult,
} from "@moddeck/shared";
import type Redis from "ioredis";
import { io, type Socket } from "socket.io-client";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { setupApp } from "../src/app.setup";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { hashToken } from "../src/realtime/participant-token";
import { REDIS } from "../src/redis/redis.module";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

jest.setTimeout(30_000);

const SUBJECT = "e2e-wordcloud-host";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function startInstance(): Promise<{ app: INestApplication; url: string }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: ["error"] });
  await setupApp(app);
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}` };
}

describe("word cloud (e2e)", () => {
  let a: { app: INestApplication; url: string };
  let b: { app: INestApplication; url: string };
  let prisma: PrismaService;
  let host: { id: string; cookie: string };
  const sockets: ClientSocket[] = [];

  const api = () => request(a.app.getHttpServer());
  const as = (r: request.Test) => r.set("Cookie", host.cookie);

  async function cleanup() {
    const users = await prisma.user.findMany({ where: { ssoSubject: SUBJECT } });
    const ownerId = { in: users.map((u) => u.id) };
    await prisma.session.deleteMany({ where: { ownerId } });
    await prisma.deck.deleteMany({ where: { ownerId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  }

  async function liveCloud(maxEntries = 1) {
    const deck = await prisma.deck.create({
      data: {
        ownerId: host.id,
        title: "Cloud deck",
        slides: {
          create: [
            { position: 0, kind: "content", elements: [] },
            {
              position: 1,
              kind: "word_cloud",
              activity: {
                create: {
                  type: "word_cloud",
                  prompt: "One word for today?",
                  maxEntriesPerPerson: maxEntries,
                },
              },
            },
          ],
        },
      },
      include: { slides: { orderBy: { position: "asc" }, include: { activity: true } } },
    });
    const res = await as(api().post(`/decks/${deck.id}/sessions`)).expect(201);
    return {
      deckId: deck.id,
      sessionId: (res.body as { id: string }).id,
      slideId: deck.slides[1].id,
      activityId: deck.slides[1].activity!.id,
    };
  }

  const act = (sessionId: string, activityId: string, action: string) =>
    as(api().patch(`/sessions/${sessionId}/activities/${activityId}`))
      .send({ action })
      .expect(200);

  const start = async (sessionId: string, activityId: string) =>
    (await act(sessionId, activityId, "start")).body.activityRunId as string;

  function connected(socket: ClientSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", (err) => reject(err));
    });
  }

  function join(socket: ClientSocket, sessionId: string): Promise<JoinAck> {
    return new Promise((resolve) => socket.emit("join", { sessionId }, resolve));
  }

  async function student(sessionId: string, url = b.url) {
    const token = randomBytes(32).toString("base64url");
    const row = await prisma.participant.create({
      data: {
        sessionId,
        loginType: "guest",
        nickname: `p-${token.slice(0, 8)}`,
        tokenHash: hashToken(token),
        tokenExpiresAt: new Date(Date.now() + 8 * 3600_000),
      },
    });
    const socket: ClientSocket = io(url, {
      transports: ["websocket"],
      reconnection: false,
      auth: { token },
    });
    sockets.push(socket);
    await connected(socket);
    expect((await join(socket, sessionId)).ok).toBe(true);
    return { socket, token, participantId: row.id };
  }

  async function hostScreen(sessionId: string) {
    const socket: ClientSocket = io(a.url, {
      transports: ["websocket"],
      reconnection: false,
      auth: { role: "host" },
      extraHeaders: { cookie: host.cookie },
    });
    sockets.push(socket);
    await connected(socket);
    expect((await join(socket, sessionId)).ok).toBe(true);
    return socket;
  }

  const send = (
    socket: ClientSocket,
    activityRunId: string,
    text: string,
    answerId: string = randomUUID(),
  ) =>
    new Promise<AnswerAck<WordResult>>((resolve) =>
      socket.emit("word", { activityRunId, text, answerId }, resolve),
    );

  function next<T extends RoomEventType>(socket: ClientSocket, type: T): Promise<RoomEvent<T>> {
    return new Promise((resolve) =>
      (socket.once as (event: string, cb: (e: RoomEvent<T>) => void) => void)(type, resolve),
    );
  }

  const liveView = async (sessionId: string) =>
    (await as(api().get(`/sessions/${sessionId}/live`)).expect(200)).body as LiveSessionView;

  const hide = (sessionId: string, activityId: string, key: string, hidden: boolean) =>
    as(
      api().patch(
        `/sessions/${sessionId}/activities/${activityId}/words/${encodeURIComponent(key)}`,
      ),
    ).send({ hidden });

  const meOf = async (token: string) =>
    (
      await api()
        .get("/participants/me")
        .set("Cookie", `${PARTICIPANT_COOKIE}=${token}`)
        .expect(200)
    ).body as ParticipantMe;

  beforeAll(async () => {
    [a, b] = await Promise.all([startInstance(), startInstance()]);
    prisma = a.app.get(PrismaService);
    await cleanup();
    const auth = a.app.get(AuthService);
    const user = await auth.upsertUser({
      subject: SUBJECT,
      email: `${SUBJECT}@kmutt.ac.th`,
      displayName: SUBJECT,
      studentId: null,
    });
    const { token } = await auth.createSession(user);
    host = { id: user.id, cookie: `host_session=${encodeURIComponent(token)}` };
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    await cleanup();
    await Promise.all([a.app.close(), b.app.close()]);
  });

  describe("the same word grows, it is not repeated", () => {
    it("counts one word from many students once, ignoring case and spaces", async () => {
      const { sessionId, activityId } = await liveCloud();
      const runId = await start(sessionId, activityId);
      const students = await Promise.all(
        Array.from({ length: 4 }, (_, i) => student(sessionId, i % 2 ? a.url : b.url)),
      );

      await Promise.all([
        send(students[0].socket, runId, "Cloud"),
        send(students[1].socket, runId, "  cloud "),
        send(students[2].socket, runId, "CLOUD"),
        send(students[3].socket, runId, "rain"),
      ]);

      const { words, entries } = (await liveView(sessionId)).clouds[runId];
      expect(entries).toBe(4);
      expect(words).toHaveLength(2);
      expect(words[0]).toMatchObject({ key: "cloud", count: 3 });
      expect(words[1]).toMatchObject({ key: "rain", count: 1 });
    });

    it("does not let one student make a word grow by sending it again", async () => {
      const { sessionId, activityId } = await liveCloud(3);
      const runId = await start(sessionId, activityId);
      const { socket } = await student(sessionId);

      expect(await send(socket, runId, "sun")).toMatchObject({
        ok: true,
        duplicate: false,
        result: { text: "sun", sent: 1 },
      });
      // The same word again, with a new answerId: nothing changes, and no entry is used up.
      expect(await send(socket, runId, " SUN ")).toMatchObject({
        ok: true,
        duplicate: true,
        result: { text: "sun", sent: 1 },
      });
      expect((await liveView(sessionId)).clouds[runId].words).toEqual([
        { key: "sun", text: "sun", count: 1 },
      ]);
    });

    it("counts a retry with the same answerId once", async () => {
      const { sessionId, activityId } = await liveCloud(2);
      const runId = await start(sessionId, activityId);
      const { socket } = await student(sessionId);

      const answerId = randomUUID();
      expect(await send(socket, runId, "moon", answerId)).toMatchObject({
        ok: true,
        duplicate: false,
      });
      expect(await send(socket, runId, "moon", answerId)).toMatchObject({
        ok: true,
        duplicate: true,
        result: { sent: 1 },
      });
      expect((await liveView(sessionId)).clouds[runId].entries).toBe(1);
    });
  });

  describe("Thai words", () => {
    it("keeps vowels and tone marks whole from the phone to the database", async () => {
      const { sessionId, activityId } = await liveCloud(3);
      const runId = await start(sessionId, activityId);
      const { socket, participantId } = await student(sessionId);

      // Sara am, tone marks above and below, and a phrase with no spaces.
      const words = ["น้ำ", "ผู้ใหญ่", "สวัสดีครับ"];
      for (const word of words) {
        expect(await send(socket, runId, `  ${word} `)).toMatchObject({
          ok: true,
          result: { text: word },
        });
      }

      const cloud = (await liveView(sessionId)).clouds[runId].words.map((w) => w.text);
      expect(cloud.sort()).toEqual([...words].sort());

      await act(sessionId, activityId, "stop");
      const rows = await prisma.wordEntry.findMany({
        where: { activityRunId: runId, participantId },
        orderBy: { text: "asc" },
      });
      expect(rows.map((row) => row.text).sort()).toEqual([...words].sort());
      expect(rows.map((row) => row.normalizedText).sort()).toEqual([...words].sort());
    });

    it("merges two Thai spellings that differ only in the order of the marks", async () => {
      const { sessionId, activityId } = await liveCloud();
      const runId = await start(sessionId, activityId);
      const one = await student(sessionId);
      const two = await student(sessionId);

      await send(one.socket, runId, "ผู้");
      await send(two.socket, runId, "ผู้");
      const { words } = (await liveView(sessionId)).clouds[runId];
      expect(words).toHaveLength(1);
      expect(words[0].count).toBe(2);
    });

    it("counts visible characters against the 25 limit, not code points", async () => {
      const { sessionId, activityId } = await liveCloud(2);
      const runId = await start(sessionId, activityId);
      const { socket } = await student(sessionId);

      const exact = "ก่".repeat(WORD_MAX_LENGTH); // 50 code points, 25 characters
      expect(await send(socket, runId, exact)).toMatchObject({ ok: true });
      expect(await send(socket, runId, "ก่".repeat(WORD_MAX_LENGTH + 1))).toMatchObject({
        ok: false,
        error: { code: "INVALID_PAYLOAD", details: { reason: "TOO_LONG" } },
      });
    });
  });

  describe("limits are enforced on the server", () => {
    it("stops a student at the limit of the activity", async () => {
      const { sessionId, activityId } = await liveCloud(2);
      const runId = await start(sessionId, activityId);
      const { socket } = await student(sessionId);

      expect(await send(socket, runId, "one")).toMatchObject({ ok: true, result: { sent: 1 } });
      expect(await send(socket, runId, "two")).toMatchObject({ ok: true, result: { sent: 2 } });
      expect(await send(socket, runId, "three")).toMatchObject({
        ok: false,
        error: { code: "LIMIT_REACHED" },
      });
      expect((await liveView(sessionId)).clouds[runId].entries).toBe(2);
    });

    it("lets only the limit through when one student sends many words at once", async () => {
      const { sessionId, activityId } = await liveCloud(2);
      const runId = await start(sessionId, activityId);
      // The same student on two instances at once, as a phone that reconnects to another one.
      const first = await student(sessionId, a.url);
      const second = await new Promise<ClientSocket>((resolve, reject) => {
        const socket: ClientSocket = io(b.url, {
          transports: ["websocket"],
          reconnection: false,
          auth: { token: first.token },
        });
        sockets.push(socket);
        socket.once("connect", () => void join(socket, sessionId).then(() => resolve(socket)));
        socket.once("connect_error", reject);
      });

      const acks = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          send(i % 2 ? first.socket : second, runId, `word-${i}`),
        ),
      );
      expect(acks.filter((ack) => ack.ok)).toHaveLength(2);
      expect(acks.filter((ack) => !ack.ok && ack.error.code === "LIMIT_REACHED")).toHaveLength(8);
      expect((await liveView(sessionId)).clouds[runId].entries).toBe(2);
    });

    it("refuses an empty word, and a payload with no text", async () => {
      const { sessionId, activityId } = await liveCloud();
      const runId = await start(sessionId, activityId);
      const { socket } = await student(sessionId);

      expect(await send(socket, runId, " \n ​ ")).toMatchObject({
        ok: false,
        error: { code: "INVALID_PAYLOAD", details: { reason: "EMPTY" } },
      });
      const bad = await new Promise<AnswerAck<WordResult>>((resolve) =>
        (socket.emit as (...args: unknown[]) => void)(
          "word",
          { activityRunId: runId, answerId: randomUUID() },
          resolve,
        ),
      );
      expect(bad).toMatchObject({ ok: false, error: { code: "INVALID_PAYLOAD" } });
    });

    it("refuses words before the start, after the stop, and from the host screen", async () => {
      const { sessionId, activityId } = await liveCloud();
      const { socket } = await student(sessionId);
      const screen = await hostScreen(sessionId);

      // Nothing has started: there is no run to send to.
      expect(await send(socket, randomUUID(), "early")).toMatchObject({
        ok: false,
        error: { code: "NOT_FOUND" },
      });

      const runId = await start(sessionId, activityId);
      expect(await send(screen, runId, "host")).toMatchObject({
        ok: false,
        error: { code: "ROOM_FORBIDDEN" },
      });

      const sent = randomUUID();
      await send(socket, runId, "kept", sent);
      await act(sessionId, activityId, "stop");
      const late = await student(sessionId);
      expect(await send(late.socket, runId, "late")).toMatchObject({
        ok: false,
        error: { code: "ACTIVITY_CLOSED" },
      });
      // A retry of a word that counted before the stop still gets its answer.
      expect(await send(socket, runId, "kept", sent)).toMatchObject({ ok: true, duplicate: true });
    });
  });

  describe("the cloud on every screen", () => {
    it("sends words in batches, at most one update per batch window", async () => {
      const { sessionId, activityId } = await liveCloud();
      const runId = await start(sessionId, activityId);
      const screen = await hostScreen(sessionId);
      const students = await Promise.all(
        Array.from({ length: 6 }, () => student(sessionId, a.url)),
      );

      const updates: { at: number; entries: number }[] = [];
      screen.on("word_update", (event) =>
        updates.push({ at: Date.now(), entries: event.data.entries }),
      );

      for (const [i, { socket }] of students.entries()) {
        await send(socket, runId, `w${i}`);
        await sleep(40);
      }
      await sleep(VOTE_BATCH_MS * 3);

      expect(updates.at(-1)?.entries).toBe(6);
      expect(updates.length).toBeLessThan(6);
      for (let i = 1; i < updates.length; i++) {
        expect(updates[i].at - updates[i - 1].at).toBeGreaterThanOrEqual(VOTE_BATCH_MS - 30);
      }
    });

    it("sends at most the top words, the most sent first", async () => {
      const { sessionId, activityId } = await liveCloud();
      const runId = await start(sessionId, activityId);
      const screen = await hostScreen(sessionId);
      const students = await Promise.all(
        Array.from({ length: 3 }, () => student(sessionId, a.url)),
      );
      for (const { socket } of students) await send(socket, runId, "popular");
      await send((await student(sessionId)).socket, runId, "rare");

      const update = next(screen, "word_update");
      await act(sessionId, activityId, "show_results");
      const { data } = await update;
      expect(data.words.map((w) => w.text)).toEqual(["popular", "rare"]);
      expect(data.words[0].count).toBe(3);
    });

    it("gives a phone the cloud with the slide only once results show", async () => {
      const { sessionId, slideId, activityId } = await liveCloud(2);
      const runId = await start(sessionId, activityId);
      const { socket, token } = await student(sessionId);
      await send(socket, runId, "kite");
      await send(socket, runId, "ลม");

      const moved = next(socket, "slide_changed");
      await as(api().patch(`/sessions/${sessionId}`))
        .send({ currentSlideId: slideId })
        .expect(200);
      const { data } = await moved;
      expect(data.activity?.activity).toMatchObject({ type: "word_cloud", maxEntries: 2 });
      expect(data.activity?.cloud).toBeNull();

      // After a reload the phone still knows what this student sent.
      const me = await meOf(token);
      expect(me.currentActivity?.myWords.sort()).toEqual(["kite", "ลม"].sort());
      expect(me.currentActivity?.cloud).toBeNull();

      await act(sessionId, activityId, "show_results");
      const after = await meOf(token);
      expect(after.currentActivity?.cloud?.entries).toBe(2);
      expect(after.currentActivity?.cloud?.words.map((w) => w.text).sort()).toEqual(
        ["kite", "ลม"].sort(),
      );
    });
  });

  describe("the host hides a word", () => {
    it("takes the word out of the cloud at once and keeps it hidden for later entries", async () => {
      const { sessionId, activityId } = await liveCloud();
      const runId = await start(sessionId, activityId);
      const screen = await hostScreen(sessionId);
      const phone = await student(sessionId);
      const one = await student(sessionId);
      await send(one.socket, runId, "okay");
      await send((await student(sessionId)).socket, runId, "rude");

      const update = next(screen, "word_update");
      const res = await hide(sessionId, activityId, "rude", true).expect(200);
      expect((res.body as WordVisibilityResult).hiddenWords).toEqual([
        { key: "rude", text: "rude", count: 1 },
      ]);
      const { data } = await update;
      expect(data.words.map((w) => w.text)).toEqual(["okay"]);
      // The response count still counts every entry: the host sees how many were sent.
      expect(data.entries).toBe(2);

      // Someone sends it again later: still hidden, and still not on the screen.
      await send((await student(sessionId)).socket, runId, "RUDE");
      const view = await liveView(sessionId);
      expect(view.clouds[runId].words.map((w) => w.text)).toEqual(["okay"]);
      expect(view.hiddenWords[runId]).toEqual([{ key: "rude", text: "rude", count: 2 }]);

      // The phone that gets the results never sees it either.
      await act(sessionId, activityId, "show_results");
      expect((await meOfSlide(phone.token, sessionId)).words).toEqual(["okay"]);
    });

    it("stores the hidden flag, also for entries that were still waiting to be written", async () => {
      const { sessionId, activityId } = await liveCloud();
      const runId = await start(sessionId, activityId);
      await send((await student(sessionId)).socket, runId, "oops");

      // Hidden before the first flush ran: the entry is still in the Redis stream.
      await hide(sessionId, activityId, "oops", true).expect(200);
      await send((await student(sessionId)).socket, runId, "oops");
      await act(sessionId, activityId, "stop");

      const rows = await prisma.wordEntry.findMany({ where: { activityRunId: runId } });
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.hidden)).toBe(true);
    });

    it("shows the word again, in the cloud and in the stored entries", async () => {
      const { sessionId, activityId } = await liveCloud();
      const runId = await start(sessionId, activityId);
      await send((await student(sessionId)).socket, runId, "hmm");
      await hide(sessionId, activityId, "hmm", true).expect(200);
      expect((await liveView(sessionId)).clouds[runId].words).toEqual([]);

      const res = await hide(sessionId, activityId, "hmm", false).expect(200);
      expect((res.body as WordVisibilityResult).hiddenWords).toEqual([]);
      expect((await liveView(sessionId)).clouds[runId].words).toHaveLength(1);

      await act(sessionId, activityId, "stop");
      const rows = await prisma.wordEntry.findMany({ where: { activityRunId: runId } });
      expect(rows.map((row) => row.hidden)).toEqual([false]);
    });

    it("hides a Thai word by its URL-encoded key", async () => {
      const { sessionId, activityId } = await liveCloud();
      const runId = await start(sessionId, activityId);
      await send((await student(sessionId)).socket, runId, "ผู้ใหญ่");
      await send((await student(sessionId)).socket, runId, "ok");

      const res = await hide(sessionId, activityId, "ผู้ใหญ่", true).expect(200);
      expect((res.body as WordVisibilityResult).hiddenWords[0].text).toBe("ผู้ใหญ่");
      expect((await liveView(sessionId)).clouds[runId].words.map((w) => w.text)).toEqual(["ok"]);
    });

    it("hides a word after the results are shown, and answers 404 for a word nobody sent", async () => {
      const { sessionId, activityId } = await liveCloud();
      const runId = await start(sessionId, activityId);
      await send((await student(sessionId)).socket, runId, "late");
      await act(sessionId, activityId, "show_results");

      await hide(sessionId, activityId, "late", true).expect(200);
      expect((await liveView(sessionId)).clouds[runId].words).toEqual([]);
      await hide(sessionId, activityId, "nobody", true).expect(404);
    });

    it("answers 404 before the activity starts, 401 without a login, 422 for a bad body", async () => {
      const { sessionId, activityId } = await liveCloud();
      await hide(sessionId, activityId, "x", true).expect(404);

      const runId = await start(sessionId, activityId);
      await send((await student(sessionId)).socket, runId, "x");
      await api()
        .patch(`/sessions/${sessionId}/activities/${activityId}/words/x`)
        .send({ hidden: true })
        .expect(401);
      await as(api().patch(`/sessions/${sessionId}/activities/${activityId}/words/x`))
        .send({ hidden: "yes" })
        .expect(422);
    });
  });

  describe("persistence and recovery", () => {
    it("writes every entry once, however often the flush runs", async () => {
      const { sessionId, activityId } = await liveCloud(2);
      const runId = await start(sessionId, activityId);
      const { socket, participantId } = await student(sessionId);
      await send(socket, runId, "a1");
      await send(socket, runId, "b2");
      await sleep(1500); // the periodic flush has run at least once
      await act(sessionId, activityId, "stop");
      await act(sessionId, activityId, "reopen");
      await act(sessionId, activityId, "stop");

      expect(await prisma.wordEntry.count({ where: { activityRunId: runId, participantId } })).toBe(
        2,
      );
    });

    it("rebuilds a run from PostgreSQL when Redis lost it, with limits and hidden words intact", async () => {
      const { sessionId, activityId } = await liveCloud(1);
      const runId = await start(sessionId, activityId);
      const { socket } = await student(sessionId);
      await send(socket, runId, "kept");
      await send((await student(sessionId)).socket, runId, "gone");
      await hide(sessionId, activityId, "gone", true).expect(200);
      await act(sessionId, activityId, "stop");

      // Redis loses the whole run, as after a restart without persistence.
      const redis = a.app.get<Redis>(REDIS);
      const keys = (await redis.keys(`*{${sessionId}}:${runId}`)).filter(
        (key) => !key.startsWith("log:"),
      );
      expect(keys.length).toBeGreaterThan(0);
      await redis.del(...keys);

      // Closed, the cloud is read from PostgreSQL.
      const view = await liveView(sessionId);
      expect(view.clouds[runId].words.map((w) => w.text)).toEqual(["kept"]);
      expect(view.hiddenWords[runId].map((w) => w.text)).toEqual(["gone"]);

      // Reopened, the student who sent a word is still at the limit.
      await act(sessionId, activityId, "reopen");
      expect(await send(socket, runId, "again")).toMatchObject({
        ok: false,
        error: { code: "LIMIT_REACHED" },
      });
      // And the word the host hid stays hidden for a new entry.
      await send((await student(sessionId)).socket, runId, "gone");
      expect((await liveView(sessionId)).clouds[runId].words.map((w) => w.text)).toEqual(["kept"]);
    });

    it("lets a reopened word cloud take more words from students under the limit", async () => {
      const { sessionId, activityId } = await liveCloud(2);
      const runId = await start(sessionId, activityId);
      const { socket } = await student(sessionId);
      await send(socket, runId, "first");
      await act(sessionId, activityId, "stop");
      expect(await send(socket, runId, "second")).toMatchObject({
        ok: false,
        error: { code: "ACTIVITY_CLOSED" },
      });

      await act(sessionId, activityId, "reopen");
      expect(await send(socket, runId, "second")).toMatchObject({ ok: true, result: { sent: 2 } });
      expect(await send(socket, runId, "third")).toMatchObject({
        ok: false,
        error: { code: "LIMIT_REACHED" },
      });
    });
  });

  describe("the host's wording", () => {
    it("sets the limit per student while the activity is in draft", async () => {
      const { deckId, slideId } = await liveCloud(1);
      const res = await as(api().patch(`/decks/${deckId}/slides/${slideId}/activity`))
        .send({ prompt: "A new prompt", maxEntries: 3 })
        .expect(200);
      expect(res.body).toMatchObject({ type: "word_cloud", prompt: "A new prompt", maxEntries: 3 });

      const deck = (await as(api().get(`/decks/${deckId}`)).expect(200)).body as {
        slides: { activity: { maxEntries: number } | null }[];
      };
      expect(deck.slides[1].activity?.maxEntries).toBe(3);
    });

    it("refuses a limit outside 1 to 3, and a limit on a poll", async () => {
      const { deckId, slideId } = await liveCloud();
      for (const maxEntries of [0, 4, 1.5]) {
        await as(api().patch(`/decks/${deckId}/slides/${slideId}/activity`))
          .send({ prompt: "x", maxEntries })
          .expect(422);
      }

      const poll = (
        await as(api().post(`/decks/${deckId}/slides`))
          .send({ kind: "poll" })
          .expect(201)
      ).body as { id: string };
      await as(api().patch(`/decks/${deckId}/slides/${poll.id}/activity`))
        .send({ prompt: "x", maxEntries: 2 })
        .expect(422);
    });

    it("locks the limit once the activity has started, but not the prompt", async () => {
      const { deckId, sessionId, slideId, activityId } = await liveCloud(1);
      await start(sessionId, activityId);

      await as(api().patch(`/decks/${deckId}/slides/${slideId}/activity`))
        .send({ prompt: "Fixed typo", maxEntries: 2 })
        .expect(409);
      // Same limit, new wording: allowed, as for a poll.
      const res = await as(api().patch(`/decks/${deckId}/slides/${slideId}/activity`))
        .send({ prompt: "Fixed typo", maxEntries: 1 })
        .expect(200);
      expect(res.body).toMatchObject({ prompt: "Fixed typo", maxEntries: 1 });
    });
  });

  // The cloud words a phone got with the slide, for the phone of the participant `token`.
  async function meOfSlide(token: string, sessionId: string) {
    const view = await liveView(sessionId);
    const slide = view.slides.find((s) => s.activity?.type === "word_cloud")!;
    await as(api().patch(`/sessions/${sessionId}`))
      .send({ currentSlideId: slide.id })
      .expect(200);
    const me = await meOf(token);
    return { words: me.currentActivity?.cloud?.words.map((w) => w.text) ?? [] };
  }
});
