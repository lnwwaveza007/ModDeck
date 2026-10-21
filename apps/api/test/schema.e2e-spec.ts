import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

// Needs a migrated database: `pnpm --filter api db:migrate && pnpm --filter api db:seed`.
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString:
      process.env.DATABASE_URL ?? "postgresql://moddeck:moddeck@localhost:5432/moddeck",
  }),
});

describe("database schema (e2e)", () => {
  const sso = `test-${randomUUID()}`;
  let hostId: string;
  let deckId: string;
  let activityId: string;
  let optionId: string;

  beforeAll(async () => {
    const host = await prisma.user.create({
      data: { ssoSubject: sso, displayName: "Schema test" },
    });
    hostId = host.id;
    const deck = await prisma.deck.create({ data: { ownerId: hostId, title: "Schema test" } });
    deckId = deck.id;
    const slide = await prisma.slide.create({
      data: { deckId, position: 0, kind: "activity" },
    });
    const activity = await prisma.activity.create({
      data: {
        slideId: slide.id,
        type: "live_poll",
        prompt: "Q?",
        options: { create: [{ position: 0, label: "A" }] },
      },
      include: { options: true },
    });
    activityId = activity.id;
    optionId = activity.options[0].id;
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { hostId } });
    await prisma.user.delete({ where: { id: hostId } }); // cascades to the deck, slides, activities
    await prisma.$disconnect();
  });

  const newSession = (pin: string) => prisma.session.create({ data: { deckId, hostId, pin } });
  const newParticipant = (sessionId: string, nickname: string) =>
    prisma.participant.create({
      data: {
        sessionId,
        nickname,
        loginType: "guest",
        tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
        tokenExpiresAt: new Date(Date.now() + 8 * 3600 * 1000),
      },
    });

  it("has the seeded demo host, deck and poll", async () => {
    const deck = await prisma.deck.findFirstOrThrow({
      where: { title: "Demo deck" },
      include: { owner: true, slides: { include: { activity: { include: { options: true } } } } },
    });
    expect(deck.owner.displayName).toBe("Demo Host");
    const poll = deck.slides.map((s) => s.activity).find((a) => a?.type === "live_poll");
    expect(poll?.options).toHaveLength(3);
  });

  it("allows one live session per PIN and frees the PIN once released", async () => {
    const first = await newSession("424242");
    await expect(newSession("424242")).rejects.toThrow();
    await prisma.session.update({
      where: { id: first.id },
      data: { status: "ended", endedAt: new Date(), pinReleasedAt: new Date() },
    });
    await expect(newSession("424242")).resolves.toBeDefined();
  });

  it("rejects a PIN that is not 6 digits", async () => {
    await expect(newSession("12ab56")).rejects.toThrow();
  });

  it("keeps guest nicknames unique per session", async () => {
    const session = await newSession("424243");
    await newParticipant(session.id, "Ploy");
    await expect(newParticipant(session.id, "Ploy")).rejects.toThrow();
  });

  it("stores one answer per participant, activity and slot", async () => {
    const session = await newSession("424244");
    const participant = await newParticipant(session.id, "Nok");
    const data = {
      sessionId: session.id,
      activityId,
      participantId: participant.id,
      optionId,
      answeredAt: new Date(),
    };
    await prisma.answer.create({ data });
    await expect(prisma.answer.create({ data })).rejects.toThrow();
    // The MD-9 flusher relies on this form of insert being a no-op for a repeat.
    const inserted = await prisma.$executeRaw`
      INSERT INTO answers (session_id, activity_id, participant_id, option_id, answered_at)
      VALUES (${session.id}::uuid, ${activityId}::uuid, ${participant.id}::uuid, ${optionId}::uuid, now())
      ON CONFLICT DO NOTHING`;
    expect(inserted).toBe(0);
  });

  it("allows one highlighted question per session", async () => {
    const session = await newSession("424245");
    const ask = (status: "highlighted" | "visible") =>
      prisma.question.create({ data: { sessionId: session.id, body: "Why?", status } });
    await ask("highlighted");
    await ask("visible");
    await expect(ask("highlighted")).rejects.toThrow();
  });

  it("limits a question vote to one per participant", async () => {
    const session = await newSession("424246");
    const participant = await newParticipant(session.id, "Mint");
    const question = await prisma.question.create({ data: { sessionId: session.id, body: "?" } });
    const data = { questionId: question.id, participantId: participant.id };
    await prisma.questionVote.create({ data });
    await expect(prisma.questionVote.create({ data })).rejects.toThrow();
  });
});
