// poll-flusher.e2e-spec.ts  (next to poll-flusher.service.ts)
import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import Redis from "ioredis";
import { PrismaService } from "../src/prisma/prisma.service";
import { REDIS } from "../src/redis/redis.module";
import { PollFlusherService } from "../src/realtime/poll-flusher.service";
import { PollStoreService, flushStreamKey } from "../src/realtime/poll-store.service";

jest.setTimeout(30_000);

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

describe("PollFlusherService (real Redis + PostgreSQL)", () => {
  let moduleRef: TestingModule;
  let redis: Redis;
  let prisma: PrismaService;
  let store: PollStoreService;
  let flusher: PollFlusherService;

  const made = { sessionIds: [] as string[], deckIds: [] as string[], userIds: [] as string[] };

  beforeAll(async () => {
    redis = new Redis(REDIS_URL);
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        PollStoreService,
        PollFlusherService,
        { provide: REDIS, useValue: redis },
      ],
    }).compile(); // no init(): the 1s flush timer must not race with the test
    prisma = moduleRef.get(PrismaService);
    store = moduleRef.get(PollStoreService);
    flusher = moduleRef.get(PollFlusherService);
    await prisma.$connect();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    for (const sid of made.sessionIds) {
      const keys = await redis.keys(`*{${sid}}*`);
      if (keys.length) await redis.del(...keys);
    }
    await prisma.session.deleteMany({ where: { id: { in: made.sessionIds } } }); // cascades participants, runs, answers
    await prisma.deck.deleteMany({ where: { id: { in: made.deckIds } } }); // cascades slides, activities, options
    await prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
    made.sessionIds = [];
    made.deckIds = [];
    made.userIds = [];
  });

  afterAll(async () => {
    await moduleRef.close();
    await redis.quit();
  });

  // ---------- helpers ----------

  async function seedSession(participantCount: number) {
    const user = await prisma.user.create({
      data: {
        ssoSubject: randomUUID(),
        email: `${randomUUID()}@test.local`,
        displayName: "Test Host",
      },
    });
    const deck = await prisma.deck.create({ data: { ownerId: user.id, title: "Flush test" } });
    const session = await prisma.session.create({
      data: {
        deckId: deck.id,
        ownerId: user.id,
        pin: String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0"),
        settings: {},
      },
    });
    made.userIds.push(user.id);
    made.deckIds.push(deck.id);
    made.sessionIds.push(session.id);

    await prisma.participant.createMany({
      data: Array.from({ length: participantCount }, (_, i) => ({
        sessionId: session.id,
        loginType: "guest" as const,
        nickname: `guest-${i}`,
        tokenHash: randomUUID(),
        tokenExpiresAt: new Date(Date.now() + 8 * 3600_000),
      })),
    });
    const participants = await prisma.participant.findMany({
      where: { sessionId: session.id },
      select: { id: true },
    });
    return {
      deckId: deck.id,
      sessionId: session.id,
      participantIds: participants.map((p) => p.id),
    };
  }

  async function addPoll(
    deckId: string,
    sessionId: string,
    position: number,
    allowAnswerChange = false,
  ) {
    const slide = await prisma.slide.create({ data: { deckId, position, kind: "poll" } });
    const activity = await prisma.activity.create({
      data: {
        slideId: slide.id,
        type: "poll",
        prompt: "Pick one",
        allowAnswerChange,
        options: { create: [0, 1, 2].map((p) => ({ position: p, label: `Option ${p}` })) },
      },
      include: { options: { orderBy: { position: "asc" } } },
    });
    const run = await prisma.activityRun.create({
      data: { sessionId, activityId: activity.id, state: "live", firstOpenedAt: new Date() },
    });
    await store.syncRun(sessionId, run.id); // what a state change does before telling the room
    return { runId: run.id, optionIds: activity.options.map((o) => o.id) };
  }

  const vote = (sessionId: string, runId: string, participantId: string, optionId: string) =>
    store.submit(sessionId, participantId, runId, optionId, randomUUID());

  async function dbVotes(runId: string, optionIds: string[]) {
    const rows = await prisma.answer.groupBy({
      by: ["optionId"],
      where: { activityRunId: runId },
      _count: { _all: true },
    });
    const byOption = Object.fromEntries(rows.map((r) => [r.optionId, r._count._all]));
    return Object.fromEntries(optionIds.map((id) => [id, byOption[id] ?? 0]));
  }

  const streamLength = (sessionId: string) => redis.xlen(flushStreamKey(sessionId));

  // ---------- tests ----------

  it("300 answers: PostgreSQL rows match the Redis counters after the flush", async () => {
    const { deckId, sessionId, participantIds } = await seedSession(300);
    const { runId, optionIds } = await addPoll(deckId, sessionId, 0);

    const outcomes = await Promise.all(
      participantIds.map((pid, i) => vote(sessionId, runId, pid, optionIds[i % 3])),
    );
    expect(outcomes.every((o) => o.status === "accepted")).toBe(true);

    const redisTally = await store.tally(sessionId, runId);
    expect(redisTally.answered).toBe(300);
    expect(Object.values(redisTally.votes).reduce((a, b) => a + b, 0)).toBe(300);
    expect(await streamLength(sessionId)).toBe(300);

    await flusher.finalFlush(sessionId);

    expect(await prisma.answer.count({ where: { activityRunId: runId } })).toBe(300);
    expect(await dbVotes(runId, optionIds)).toEqual(redisTally.votes);
    expect(await streamLength(sessionId)).toBe(0);
  });

  it("running the flush twice creates no duplicates", async () => {
    const { deckId, sessionId, participantIds } = await seedSession(300);
    const { runId, optionIds } = await addPoll(deckId, sessionId, 0);
    await Promise.all(
      participantIds.map((pid, i) => vote(sessionId, runId, pid, optionIds[i % 3])),
    );
    const redisTally = await store.tally(sessionId, runId);

    await flusher.finalFlush(sessionId);
    await flusher.finalFlush(sessionId); // second run finds an empty stream

    expect(await prisma.answer.count({ where: { activityRunId: runId } })).toBe(300);
    expect(await dbVotes(runId, optionIds)).toEqual(redisTally.votes);
    expect(await streamLength(sessionId)).toBe(0);
  });

  it("a crash between the write and XDEL replays the batch without duplicates", async () => {
    const { deckId, sessionId, participantIds } = await seedSession(300);
    const { runId, optionIds } = await addPoll(deckId, sessionId, 0);
    await Promise.all(
      participantIds.map((pid, i) => vote(sessionId, runId, pid, optionIds[i % 3])),
    );
    const redisTally = await store.tally(sessionId, runId);

    const errorLog = jest.spyOn(Logger.prototype, "error").mockImplementation();
    const writeSpy = jest.spyOn(
      flusher as unknown as { write: (...args: never[]) => Promise<void> },
      "write",
    );
    // The rows are written, then XDEL fails once: the entries stay in the stream.
    jest.spyOn(redis, "xdel").mockRejectedValueOnce(new Error("redis went away"));

    await flusher.finalFlush(sessionId); // fails once, retries after ~1s, writes the same batch again

    expect(writeSpy).toHaveBeenCalledTimes(2); // the batch really was written twice
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(await prisma.answer.count({ where: { activityRunId: runId } })).toBe(300);
    expect(await dbVotes(runId, optionIds)).toEqual(redisTally.votes);
    expect(await streamLength(sessionId)).toBe(0);
  });

  it("a failed flush is logged and retried until it succeeds", async () => {
    const { deckId, sessionId, participantIds } = await seedSession(300);
    const { runId, optionIds } = await addPoll(deckId, sessionId, 0);
    await Promise.all(
      participantIds.map((pid, i) => vote(sessionId, runId, pid, optionIds[i % 3])),
    );

    const errorLog = jest.spyOn(Logger.prototype, "error").mockImplementation();
    const writeSpy = jest
      .spyOn(flusher as unknown as { write: (...args: never[]) => Promise<void> }, "write")
      .mockRejectedValueOnce(new Error("db down")); // later calls use the real write

    await flusher.finalFlush(sessionId); // first attempt fails, retries after ~1s

    expect(writeSpy).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(String(errorLog.mock.calls[0][0])).toContain("Final answer flush failed");
    expect(String(errorLog.mock.calls[0][0])).toContain("db down");
    expect(await prisma.answer.count({ where: { activityRunId: runId } })).toBe(300);
    expect(await streamLength(sessionId)).toBe(0);
  });

  it("one final flush writes every open activity of the session", async () => {
    const { deckId, sessionId, participantIds } = await seedSession(150);
    const a = await addPoll(deckId, sessionId, 0);
    const b = await addPoll(deckId, sessionId, 1);

    await Promise.all(
      participantIds.flatMap((pid, i) => [
        vote(sessionId, a.runId, pid, a.optionIds[i % 3]),
        vote(sessionId, b.runId, pid, b.optionIds[(i + 1) % 3]),
      ]),
    );
    expect(await streamLength(sessionId)).toBe(300);

    await flusher.finalFlush(sessionId);

    expect(await prisma.answer.count({ where: { activityRunId: a.runId } })).toBe(150);
    expect(await prisma.answer.count({ where: { activityRunId: b.runId } })).toBe(150);
    expect(await dbVotes(a.runId, a.optionIds)).toEqual(
      (await store.tally(sessionId, a.runId)).votes,
    );
    expect(await dbVotes(b.runId, b.optionIds)).toEqual(
      (await store.tally(sessionId, b.runId)).votes,
    );
    expect(await streamLength(sessionId)).toBe(0);
  });

  it("a changed answer replaces the stored row instead of adding a second one", async () => {
    const { deckId, sessionId, participantIds } = await seedSession(1);
    const { runId, optionIds } = await addPoll(deckId, sessionId, 0, true);
    const [pid] = participantIds;

    expect((await vote(sessionId, runId, pid, optionIds[0])).status).toBe("accepted");
    await flusher.finalFlush(sessionId);
    expect((await vote(sessionId, runId, pid, optionIds[1])).status).toBe("accepted");
    await flusher.finalFlush(sessionId);

    const rows = await prisma.answer.findMany({ where: { activityRunId: runId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].optionId).toBe(optionIds[1]);
    expect(await dbVotes(runId, optionIds)).toEqual((await store.tally(sessionId, runId)).votes);
  });
});
