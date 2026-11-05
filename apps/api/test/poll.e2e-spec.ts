// Live poll end to end: the host runs a poll, students vote over the socket, and the counts reach
// every screen. Real Postgres and Redis; two api instances behind one Redis, as on staging.

import { randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  PARTICIPANT_COOKIE,
  VOTE_BATCH_MS,
  type AnswerAck,
  type ClientToServerEvents,
  type JoinAck,
  type LiveSessionView,
  type ParticipantMe,
  type RoomEvent,
  type RoomEventType,
  type ServerToClientEvents,
  type VoteResult,
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

const SUBJECT = "e2e-poll-host";

async function startInstance(): Promise<{ app: INestApplication; url: string }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: ["error"] });
  await setupApp(app);
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}` };
}

describe("live poll (e2e)", () => {
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

  async function livePoll(allowAnswerChange = false) {
    const deck = await prisma.deck.create({
      data: {
        ownerId: host.id,
        title: "Poll deck",
        slides: {
          create: [
            { position: 0, kind: "content", elements: [] },
            {
              position: 1,
              kind: "poll",
              activity: {
                create: {
                  type: "poll",
                  prompt: "Which `layer`?",
                  allowAnswerChange,
                  options: {
                    create: [
                      { position: 0, label: "Alpha" },
                      { position: 1, label: "$x^2$" },
                      { position: 2, label: "Gamma" },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
      include: {
        slides: {
          orderBy: { position: "asc" },
          include: { activity: { include: { options: { orderBy: { position: "asc" } } } } },
        },
      },
    });
    const res = await as(api().post(`/decks/${deck.id}/sessions`)).expect(201);
    const activity = deck.slides[1].activity!;
    return {
      sessionId: (res.body as { id: string }).id,
      slideId: deck.slides[1].id,
      activityId: activity.id,
      options: activity.options.map((option) => option.id),
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

  const vote = (
    socket: ClientSocket,
    activityRunId: string,
    optionId: string,
    answerId: string = randomUUID(),
  ) =>
    new Promise<AnswerAck<VoteResult>>((resolve) =>
      socket.emit("vote", { activityRunId, optionIds: [optionId], answerId }, resolve),
    );

  function next<T extends RoomEventType>(socket: ClientSocket, type: T): Promise<RoomEvent<T>> {
    return new Promise((resolve) =>
      (socket.once as (event: string, cb: (e: RoomEvent<T>) => void) => void)(type, resolve),
    );
  }

  const liveView = async (sessionId: string) =>
    (await as(api().get(`/sessions/${sessionId}/live`)).expect(200)).body as LiveSessionView;

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

  describe("one answer per participant", () => {
    it("counts a retry with the same answerId once", async () => {
      const { sessionId, activityId, options } = await livePoll();
      const runId = await start(sessionId, activityId);
      const { socket } = await student(sessionId);

      const answerId = randomUUID();
      expect(await vote(socket, runId, options[0], answerId)).toEqual({
        ok: true,
        duplicate: false,
        result: { optionIds: [options[0]] },
      });
      expect(await vote(socket, runId, options[0], answerId)).toEqual({
        ok: true,
        duplicate: true,
        result: { optionIds: [options[0]] },
      });

      const view = await liveView(sessionId);
      expect(view.tallies[runId].answered).toBe(1);
      expect(view.tallies[runId].votes[options[0]]).toBe(1);
    });

    it("keeps the first answer when a student votes again", async () => {
      const { sessionId, activityId, options } = await livePoll();
      const runId = await start(sessionId, activityId);
      const { socket } = await student(sessionId);

      await vote(socket, runId, options[0]);
      expect(await vote(socket, runId, options[1])).toEqual({
        ok: true,
        duplicate: true,
        result: { optionIds: [options[0]] },
      });

      const { votes, answered } = (await liveView(sessionId)).tallies[runId];
      expect(answered).toBe(1);
      expect(votes).toMatchObject({ [options[0]]: 1, [options[1]]: 0 });
    });

    it("counts each student once in a burst across two instances", async () => {
      const { sessionId, activityId, options } = await livePoll();
      const runId = await start(sessionId, activityId);
      const students = await Promise.all(
        Array.from({ length: 30 }, (_, i) => student(sessionId, i % 2 ? a.url : b.url)),
      );

      // Every student taps three times at once: a double tap, a retry and another option.
      const acks = await Promise.all(
        students.flatMap(({ socket }, i) => {
          const answerId = randomUUID();
          const option = options[i % options.length];
          return [
            vote(socket, runId, option, answerId),
            vote(socket, runId, option, answerId),
            vote(socket, runId, options[(i + 1) % options.length]),
          ];
        }),
      );

      expect(acks.every((ack) => ack.ok)).toBe(true);
      const accepted = acks.filter((ack) => ack.ok && !ack.duplicate);
      expect(accepted).toHaveLength(30);
      const { votes, answered } = (await liveView(sessionId)).tallies[runId];
      expect(answered).toBe(30);
      expect(Object.values(votes).reduce((sum, count) => sum + count, 0)).toBe(30);

      await act(sessionId, activityId, "stop");
      expect(await prisma.answer.count({ where: { activityRunId: runId } })).toBe(30);
    });

    it("lets the host's option setting replace an answer", async () => {
      const { sessionId, activityId, options } = await livePoll(true);
      const runId = await start(sessionId, activityId);
      const { socket, participantId } = await student(sessionId);

      await vote(socket, runId, options[0]);
      expect(await vote(socket, runId, options[1])).toMatchObject({ ok: true, duplicate: false });

      const { votes, answered } = (await liveView(sessionId)).tallies[runId];
      expect(answered).toBe(1);
      expect(votes).toMatchObject({ [options[0]]: 0, [options[1]]: 1 });

      await act(sessionId, activityId, "stop");
      const rows = await prisma.answer.findMany({ where: { activityRunId: runId, participantId } });
      expect(rows.map((row) => row.optionId)).toEqual([options[1]]);
    });
  });

  describe("what a vote is refused for", () => {
    it("refuses a vote when the poll is closed, and still answers a retry of a counted one", async () => {
      const { sessionId, activityId, options } = await livePoll();
      const runId = await start(sessionId, activityId);
      const counted = await student(sessionId);
      const late = await student(sessionId);
      const answerId = randomUUID();
      await vote(counted.socket, runId, options[0], answerId);

      await act(sessionId, activityId, "stop");

      expect(await vote(late.socket, runId, options[0])).toMatchObject({
        ok: false,
        error: { code: "ACTIVITY_CLOSED" },
      });
      expect(await vote(counted.socket, runId, options[0], answerId)).toMatchObject({
        ok: true,
        duplicate: true,
      });
    });

    it("refuses an option of another poll, a run of another session, and a bad payload", async () => {
      const first = await livePoll();
      const second = await livePoll();
      const firstRun = await start(first.sessionId, first.activityId);
      const secondRun = await start(second.sessionId, second.activityId);
      const { socket } = await student(first.sessionId);

      expect(await vote(socket, firstRun, second.options[0])).toMatchObject({
        ok: false,
        error: { code: "INVALID_PAYLOAD" },
      });
      expect(await vote(socket, secondRun, second.options[0])).toMatchObject({
        ok: false,
        error: { code: "NOT_FOUND" },
      });
      const bad = await new Promise<AnswerAck<VoteResult>>((resolve) =>
        (socket.emit as (...args: unknown[]) => void)(
          "vote",
          { activityRunId: firstRun, optionIds: [], answerId: randomUUID() },
          resolve,
        ),
      );
      expect(bad).toMatchObject({ ok: false, error: { code: "INVALID_PAYLOAD" } });
    });

    it("refuses a vote from the host's screen", async () => {
      const { sessionId, activityId, options } = await livePoll();
      const runId = await start(sessionId, activityId);
      const screen = await hostScreen(sessionId);
      expect(await vote(screen, runId, options[0])).toMatchObject({
        ok: false,
        error: { code: "ROOM_FORBIDDEN" },
      });
    });
  });

  describe("counts on every screen", () => {
    it("sends votes in batches, at most one update per batch window", async () => {
      const { sessionId, activityId, options } = await livePoll();
      const runId = await start(sessionId, activityId);
      const screen = await hostScreen(sessionId);
      const students = await Promise.all(
        Array.from({ length: 6 }, () => student(sessionId, a.url)),
      );

      const updates: { at: number; answered: number }[] = [];
      screen.on("vote_update", (event) =>
        updates.push({ at: Date.now(), answered: event.data.answered }),
      );

      for (const { socket } of students) {
        await vote(socket, runId, options[0]);
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      await new Promise((resolve) => setTimeout(resolve, VOTE_BATCH_MS * 3));

      expect(updates.at(-1)?.answered).toBe(6);
      // Six votes over 240 ms arrive as fewer updates than votes.
      expect(updates.length).toBeLessThan(6);
      for (let i = 1; i < updates.length; i++) {
        // A little room for timer and network jitter.
        expect(updates[i].at - updates[i - 1].at).toBeGreaterThanOrEqual(VOTE_BATCH_MS - 30);
      }
    });

    it("tells phones the activity with the slide, without the counts until results show", async () => {
      const { sessionId, slideId, activityId, options } = await livePoll();
      const runId = await start(sessionId, activityId);
      const { socket, token } = await student(sessionId);
      await vote(socket, runId, options[1]);

      const moved = next(socket, "slide_changed");
      await as(api().patch(`/sessions/${sessionId}`))
        .send({ currentSlideId: slideId })
        .expect(200);
      const { data } = await moved;
      expect(data.activity?.activity.prompt).toBe("Which `layer`?");
      expect(data.activity?.run?.state).toBe("live");
      expect(data.activity?.results).toBeNull();

      const me = (
        await api()
          .get("/participants/me")
          .set("Cookie", `${PARTICIPANT_COOKIE}=${token}`)
          .expect(200)
      ).body as ParticipantMe;
      expect(me.currentActivity?.myOptionId).toBe(options[1]);
      expect(me.currentActivity?.results).toBeNull();

      const update = next(socket, "vote_update");
      await act(sessionId, activityId, "show_results");
      expect((await update).data).toMatchObject({ activityRunId: runId, answered: 1 });
      const after = (
        await api()
          .get("/participants/me")
          .set("Cookie", `${PARTICIPANT_COOKIE}=${token}`)
          .expect(200)
      ).body as ParticipantMe;
      expect(after.currentActivity?.results?.answered).toBe(1);
    });
  });

  describe("activity states", () => {
    it("hides results, and a reopen keeps answers, takes changes and flags them", async () => {
      const { sessionId, activityId, options } = await livePoll();
      const runId = await start(sessionId, activityId);
      const early = await student(sessionId);
      const late = await student(sessionId);
      await vote(early.socket, runId, options[0]);

      await act(sessionId, activityId, "show_results");
      expect((await act(sessionId, activityId, "hide_results")).body.state).toBe("closed");
      const reopened = await act(sessionId, activityId, "reopen");
      expect(reopened.body).toMatchObject({ state: "live", reopened: true });
      expect((await liveView(sessionId)).tallies[runId].answered).toBe(1);

      expect(await vote(early.socket, runId, options[2])).toMatchObject({ duplicate: false });
      expect(await vote(late.socket, runId, options[1])).toMatchObject({ duplicate: false });

      const { votes, answered } = (await liveView(sessionId)).tallies[runId];
      expect(answered).toBe(2);
      expect(votes).toEqual({ [options[0]]: 0, [options[1]]: 1, [options[2]]: 1 });

      await act(sessionId, activityId, "stop");
      const rows = await prisma.answer.findMany({ where: { activityRunId: runId } });
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.afterReopen)).toBe(true);
    });

    it("has every answer in the database when the close returns", async () => {
      const { sessionId, activityId, options } = await livePoll();
      const runId = await start(sessionId, activityId);
      const { socket, participantId } = await student(sessionId);
      await vote(socket, runId, options[0]);

      await act(sessionId, activityId, "stop");

      const row = await prisma.answer.findFirst({ where: { activityRunId: runId, participantId } });
      expect(row).toMatchObject({ optionId: options[0], afterReopen: false });
    });

    it("writes answers to the database while the poll stays open", async () => {
      const { sessionId, activityId, options } = await livePoll();
      const runId = await start(sessionId, activityId);
      const { socket } = await student(sessionId);
      await vote(socket, runId, options[0]);

      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if ((await prisma.answer.count({ where: { activityRunId: runId } })) === 1) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(await prisma.answer.count({ where: { activityRunId: runId } })).toBe(1);
    });

    it("closes a live poll with the session, and keeps its answers", async () => {
      const { sessionId, activityId, options } = await livePoll();
      const runId = await start(sessionId, activityId);
      const { socket } = await student(sessionId);
      await vote(socket, runId, options[0]);

      await as(api().patch(`/sessions/${sessionId}`))
        .send({ status: "ended" })
        .expect(200);

      const run = await prisma.activityRun.findUniqueOrThrow({ where: { id: runId } });
      expect(run.state).toBe("closed");
      expect(await prisma.answer.count({ where: { activityRunId: runId } })).toBe(1);
      expect((await liveView(sessionId)).tallies[runId].answered).toBe(1);
    });
  });

  describe("recovery", () => {
    it("rebuilds a run from the database when Redis has lost it", async () => {
      const { sessionId, activityId, options } = await livePoll();
      const runId = await start(sessionId, activityId);
      const first = await student(sessionId);
      const second = await student(sessionId);
      await vote(first.socket, runId, options[0]);
      await act(sessionId, activityId, "stop");
      await act(sessionId, activityId, "reopen");
      await act(sessionId, activityId, "stop");
      await act(sessionId, activityId, "reopen");

      const redis = a.app.get<Redis>(REDIS);
      await redis.del(`run:{${sessionId}}:${runId}`, `ans:{${sessionId}}:${runId}`);
      await redis.del(`votes:{${sessionId}}:${runId}`);

      expect(await vote(second.socket, runId, options[1])).toMatchObject({
        ok: true,
        duplicate: false,
      });
      const { votes, answered } = (await liveView(sessionId)).tallies[runId];
      expect(answered).toBe(2);
      expect(votes).toMatchObject({ [options[0]]: 1, [options[1]]: 1 });
    });
  });
});
