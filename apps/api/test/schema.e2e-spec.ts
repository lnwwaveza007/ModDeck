// Checks the migrated and seeded database. Needs DATABASE_URL (or the local
// docker-compose Postgres) with `pnpm db:deploy` and `pnpm db:seed` already run.

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const LOCAL_DATABASE_URL = "postgresql://moddeck:moddeck@localhost:5432/moddeck";

describe("database schema (e2e)", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? LOCAL_DATABASE_URL }),
  });
  const createdSessionIds: string[] = [];

  afterAll(async () => {
    // Sessions cascade to participants, runs and answers.
    await prisma.session.deleteMany({ where: { id: { in: createdSessionIds } } });
    await prisma.$disconnect();
  });

  async function demoPoll() {
    const host = await prisma.user.findUniqueOrThrow({ where: { ssoSubject: "demo-host" } });
    const deck = await prisma.deck.findFirstOrThrow({
      where: { ownerId: host.id, title: "Demo deck" },
      include: { slides: { include: { activity: { include: { options: true } } } } },
    });
    const poll = deck.slides.find((s) => s.activity?.type === "poll")?.activity;
    if (!poll) throw new Error("demo deck has no poll");
    return { host, deck, poll };
  }

  async function startSession(pin: string) {
    const { host, deck } = await demoPoll();
    const session = await prisma.session.create({
      data: { deckId: deck.id, ownerId: host.id, pin, settings: {} },
    });
    createdSessionIds.push(session.id);
    return session;
  }

  it("seed creates one demo host, deck and poll", async () => {
    const { poll } = await demoPoll();
    expect(poll.options.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects a second live session with the same PIN", async () => {
    await startSession("900001");
    await expect(startSession("900001")).rejects.toThrow();
  });

  it("lets a new session reuse the PIN of an ended one", async () => {
    const ended = await startSession("900002");
    await prisma.session.update({
      where: { id: ended.id },
      data: { status: "ended", endedAt: new Date(), endReason: "host" },
    });
    await expect(startSession("900002")).resolves.toMatchObject({ pin: "900002" });
  });

  it("drops a repeated answer in the flush insert (MD-9)", async () => {
    const { poll } = await demoPoll();
    const session = await startSession("900003");
    const run = await prisma.activityRun.create({
      data: { sessionId: session.id, activityId: poll.id, state: "live" },
    });
    const participant = await prisma.participant.create({
      data: {
        sessionId: session.id,
        loginType: "guest",
        nickname: "Tester",
        tokenHash: `test-${session.id}`,
        tokenExpiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
      },
    });
    const flush = () => prisma.$executeRaw`
      INSERT INTO answers (activity_run_id, participant_id, option_id, answered_at)
      VALUES (${run.id}::uuid, ${participant.id}::uuid, ${poll.options[0].id}::uuid, now())
      ON CONFLICT DO NOTHING`;

    expect(await flush()).toBe(1);
    expect(await flush()).toBe(0);
  });
});
