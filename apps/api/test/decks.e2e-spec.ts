// My decks end to end against the real database: list, create, rename, duplicate
// and soft delete, each scoped to the logged-in host. Two hosts log in through
// AuthService.createSession, the same call /auth/callback makes after SSO.

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { DeckSummary } from "@moddeck/shared";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma/prisma.service";

const SUBJECTS = ["e2e-decks-host-a", "e2e-decks-host-b"];

describe("decks (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let hostA: { id: string; cookie: string };
  let hostB: { id: string; cookie: string };

  async function login(subject: string) {
    const auth = app.get(AuthService);
    const user = await auth.upsertUser({
      subject,
      email: `${subject}@kmutt.ac.th`,
      displayName: subject,
      studentId: null,
    });
    const { token } = await auth.createSession(user);
    return { id: user.id, cookie: `host_session=${encodeURIComponent(token)}` };
  }

  async function cleanup() {
    const users = await prisma.user.findMany({ where: { ssoSubject: { in: SUBJECTS } } });
    const ownerId = { in: users.map((u) => u.id) };
    // Owners are RESTRICT, so sessions and decks go before the users.
    await prisma.session.deleteMany({ where: { ownerId } });
    await prisma.deck.deleteMany({ where: { ownerId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  }

  const api = () => request(app.getHttpServer());

  async function createDeck(cookie: string, title: string): Promise<DeckSummary> {
    const res = await api().post("/decks").set("Cookie", cookie).send({ title }).expect(201);
    return res.body;
  }

  async function startSession(deckId: string, ownerId: string, status: "live" | "ended") {
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    return prisma.session.create({ data: { deckId, ownerId, pin, status, settings: {} } });
  }

  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    await cleanup();
    hostA = await login(SUBJECTS[0]);
    hostB = await login(SUBJECTS[1]);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it("needs a host login", async () => {
    await api().get("/decks").expect(401);
    await api().post("/decks").send({ title: "x" }).expect(401);
  });

  it("gives a new host an empty list", async () => {
    const res = await api().get("/decks").set("Cookie", hostB.cookie).expect(200);
    expect(res.body).toEqual([]);
  });

  it("creates a deck with one blank title slide", async () => {
    const res = await api()
      .post("/decks")
      .set("Cookie", hostA.cookie)
      .send({ title: "  INT365 W05 Routing  " })
      .expect(201);
    expect(res.headers.location).toBe(`/api/decks/${res.body.id}`);
    expect(res.body).toMatchObject({
      title: "INT365 W05 Routing",
      slideCount: 1,
      sessionCount: 0,
      liveSessions: [],
    });
    const slides = await prisma.slide.findMany({ where: { deckId: res.body.id } });
    expect(slides).toMatchObject([{ position: 0, kind: "text", content: null }]);
  });

  it("rejects a blank or missing title with 422", async () => {
    for (const body of [{ title: "   " }, {}, { title: 42 }]) {
      const res = await api().post("/decks").set("Cookie", hostA.cookie).send(body).expect(422);
      expect(res.body.error.code).toBe("INVALID_PAYLOAD");
    }
  });

  it("lists only my decks, newest edit first", async () => {
    const older = await createDeck(hostA.cookie, "A older");
    const newer = await createDeck(hostA.cookie, "A newer");
    const other = await createDeck(hostB.cookie, "B only");

    const res = await api().get("/decks").set("Cookie", hostA.cookie).expect(200);
    const ids = (res.body as DeckSummary[]).map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining([older.id, newer.id]));
    expect(ids).not.toContain(other.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
  });

  it("renames a deck, and the new title persists", async () => {
    const deck = await createDeck(hostA.cookie, "Draft");
    const res = await api()
      .patch(`/decks/${deck.id}`)
      .set("Cookie", hostA.cookie)
      .send({ title: "Final" })
      .expect(200);
    expect(res.body.title).toBe("Final");
    expect(Date.parse(res.body.updatedAt)).toBeGreaterThanOrEqual(Date.parse(deck.updatedAt));

    const again = await api().get(`/decks/${deck.id}`).set("Cookie", hostA.cookie).expect(200);
    expect(again.body.title).toBe("Final");

    await api()
      .patch(`/decks/${deck.id}`)
      .set("Cookie", hostA.cookie)
      .send({ title: "" })
      .expect(422);
  });

  it("duplicates slides, activities, options and settings, but not sessions", async () => {
    const source = await prisma.deck.create({
      data: {
        ownerId: hostA.id,
        title: "Poll deck",
        qaEnabled: false,
        reactionsEnabled: true,
        slides: {
          create: [
            { position: 0, kind: "text", content: "Welcome" },
            {
              position: 1,
              kind: "poll",
              activity: {
                create: {
                  type: "poll",
                  prompt: "Pick one",
                  multipleChoice: true,
                  options: {
                    create: [
                      { position: 0, label: "A" },
                      { position: 1, label: "B" },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    });
    await startSession(source.id, hostA.id, "ended");

    const res = await api()
      .post(`/decks/${source.id}/copies`)
      .set("Cookie", hostA.cookie)
      .send({ title: "Copy of Poll deck" })
      .expect(201);
    expect(res.headers.location).toBe(`/api/decks/${res.body.id}`);
    expect(res.body).toMatchObject({ title: "Copy of Poll deck", slideCount: 2, sessionCount: 0 });

    const copy = await prisma.deck.findUniqueOrThrow({
      where: { id: res.body.id },
      include: {
        slides: {
          orderBy: { position: "asc" },
          include: { activity: { include: { options: true } } },
        },
      },
    });
    expect(copy).toMatchObject({ ownerId: hostA.id, qaEnabled: false, reactionsEnabled: true });
    expect(copy.slides.map((s) => s.content ?? s.kind)).toEqual(["Welcome", "poll"]);
    expect(copy.slides[1].activity).toMatchObject({ prompt: "Pick one", multipleChoice: true });
    expect(copy.slides[1].activity?.options.map((o) => o.label).sort()).toEqual(["A", "B"]);

    // The original keeps its own rows.
    expect(await prisma.slide.count({ where: { deckId: source.id } })).toBe(2);

    const noTitle = await api()
      .post(`/decks/${source.id}/copies`)
      .set("Cookie", hostA.cookie)
      .expect(201);
    expect(noTitle.body.title).toBe("Poll deck (copy)");
  });

  it("soft deletes: the deck leaves the list but its past sessions stay", async () => {
    const deck = await createDeck(hostA.cookie, "To delete");
    const past = await startSession(deck.id, hostA.id, "ended");

    await api().delete(`/decks/${deck.id}`).set("Cookie", hostA.cookie).expect(204);

    const list = await api().get("/decks").set("Cookie", hostA.cookie).expect(200);
    expect((list.body as DeckSummary[]).map((d) => d.id)).not.toContain(deck.id);
    await api().get(`/decks/${deck.id}`).set("Cookie", hostA.cookie).expect(404);
    await api().delete(`/decks/${deck.id}`).set("Cookie", hostA.cookie).expect(404);
    await api().post(`/decks/${deck.id}/copies`).set("Cookie", hostA.cookie).expect(404);

    const row = await prisma.deck.findUniqueOrThrow({ where: { id: deck.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(await prisma.session.count({ where: { id: past.id } })).toBe(1);
  });

  it("refuses to delete a deck while a session on it is live", async () => {
    const deck = await createDeck(hostA.cookie, "Live deck");
    const live = await startSession(deck.id, hostA.id, "live");

    const list = await api().get("/decks").set("Cookie", hostA.cookie).expect(200);
    expect((list.body as DeckSummary[]).find((d) => d.id === deck.id)?.liveSessions).toEqual([
      { id: live.id, pin: live.pin },
    ]);

    const res = await api().delete(`/decks/${deck.id}`).set("Cookie", hostA.cookie).expect(409);
    expect(res.body.error.code).toBe("DECK_LIVE");
    expect((await prisma.deck.findUniqueOrThrow({ where: { id: deck.id } })).deletedAt).toBeNull();
  });

  it("answers 404 for another host's deck, and changes nothing", async () => {
    const deck = await createDeck(hostA.cookie, "A private");
    const as = (r: request.Test) => r.set("Cookie", hostB.cookie);

    for (const res of [
      await as(api().get(`/decks/${deck.id}`)),
      await as(api().patch(`/decks/${deck.id}`)).send({ title: "Hijacked" }),
      await as(api().delete(`/decks/${deck.id}`)),
      await as(api().post(`/decks/${deck.id}/copies`)),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    }

    const row = await prisma.deck.findUniqueOrThrow({ where: { id: deck.id } });
    expect(row).toMatchObject({ title: "A private", deletedAt: null });
    expect(
      await prisma.deck.count({ where: { ownerId: hostB.id, title: { contains: "A private" } } }),
    ).toBe(0);
  });

  it("answers 404 for a deck id that is not a UUID", async () => {
    await api().get("/decks/not-a-uuid").set("Cookie", hostA.cookie).expect(404);
  });
});
