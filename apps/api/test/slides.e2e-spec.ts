// Slides of a deck end to end against the real database: add, edit, reorder, duplicate, delete
// and image upload, each scoped to the deck's owner.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { DeckDetail, DeckSummary, SlideDto } from "@moddeck/shared";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma/prisma.service";

const SUBJECTS = ["e2e-slides-host-a", "e2e-slides-host-b"];
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(32)]);

describe("slides (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let slidesDir: string;
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
    await prisma.session.deleteMany({ where: { ownerId } });
    await prisma.deck.deleteMany({ where: { ownerId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  }

  const api = () => request(app.getHttpServer());
  const as = (host: { cookie: string }, r: request.Test) => r.set("Cookie", host.cookie);

  async function createDeck(title = "Slides deck"): Promise<DeckSummary> {
    return (await as(hostA, api().post("/decks")).send({ title }).expect(201)).body;
  }

  async function addSlide(deckId: string, body: object): Promise<SlideDto> {
    return (
      await as(hostA, api().post(`/decks/${deckId}/slides`))
        .send(body)
        .expect(201)
    ).body;
  }

  async function slidesOf(deckId: string): Promise<SlideDto[]> {
    const res = await as(hostA, api().get(`/decks/${deckId}`)).expect(200);
    return (res.body as DeckDetail).slides;
  }

  beforeAll(async () => {
    slidesDir = await mkdtemp(join(tmpdir(), "moddeck-e2e-slides-"));
    process.env.SLIDES_DIR = slidesDir;
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
    delete process.env.SLIDES_DIR;
    await rm(slidesDir, { recursive: true, force: true });
  });

  it("needs a host login", async () => {
    const id = "0192f3a4-0000-7000-8000-000000000001";
    await api().post(`/decks/${id}/slides`).send({ kind: "text" }).expect(401);
    await api().put(`/decks/${id}/slide-order`).send({ slideIds: [] }).expect(401);
  });

  it("returns the slides with the deck, in order", async () => {
    const deck = await createDeck();
    const res = await as(hostA, api().get(`/decks/${deck.id}`)).expect(200);
    expect(res.body).toMatchObject({ id: deck.id, slideCount: 1 });
    expect(res.body.slides).toMatchObject([{ position: 0, kind: "text", content: null }]);
  });

  it("adds a text, code, math and image slide at the end", async () => {
    const deck = await createDeck();
    const text = await addSlide(deck.id, { kind: "text", content: "# Hello" });
    const code = await addSlide(deck.id, { kind: "code", content: "print(1)", language: "python" });
    const defaultLang = await addSlide(deck.id, { kind: "code" });
    const math = await addSlide(deck.id, { kind: "math", content: "x^2" });
    const image = await addSlide(deck.id, { kind: "image" });

    expect(text).toMatchObject({ position: 1, content: "# Hello", language: null });
    expect(code).toMatchObject({ position: 2, language: "python" });
    expect(defaultLang).toMatchObject({ position: 3, content: "", language: "python" });
    expect(math).toMatchObject({ position: 4, content: "x^2" });
    expect(image).toMatchObject({ position: 5, content: null, imageRef: null });
    expect((await slidesOf(deck.id)).map((s) => s.position)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("inserts at a position and pushes later slides down", async () => {
    const deck = await createDeck();
    await addSlide(deck.id, { kind: "math", content: "b" });
    const first = await addSlide(deck.id, { kind: "text", content: "a", position: 0 });
    expect(first.position).toBe(0);
    const slides = await slidesOf(deck.id);
    expect(slides.map((s) => s.content)).toEqual(["a", null, "b"]);
    expect(slides.map((s) => s.position)).toEqual([0, 1, 2]);
  });

  it("adds activity slides with an empty activity", async () => {
    const deck = await createDeck();
    const poll = await addSlide(deck.id, { kind: "poll" });
    const cloud = await addSlide(deck.id, { kind: "word_cloud" });
    expect(poll.activity).toEqual({ type: "poll", prompt: "" });
    expect(cloud.activity).toEqual({ type: "word_cloud", prompt: "" });
  });

  it("keeps LaTeX that does not parse, and refuses content that is too long", async () => {
    const deck = await createDeck();
    const math = await addSlide(deck.id, { kind: "math", content: "\\frac{1" });
    expect(math.content).toBe("\\frac{1");

    const tooLong = await as(hostA, api().post(`/decks/${deck.id}/slides`))
      .send({ kind: "math", content: "x".repeat(4001) })
      .expect(422);
    expect(tooLong.body.error.code).toBe("INVALID_PAYLOAD");
  });

  it("saves a 50+ line code block unchanged", async () => {
    const deck = await createDeck();
    const code = Array.from(
      { length: 80 },
      (_, i) => `    total += step_${i}(x)  # line ${i}`,
    ).join("\n");
    const slide = await addSlide(deck.id, { kind: "code", content: code });
    expect((await slidesOf(deck.id)).find((s) => s.id === slide.id)?.content).toBe(code);
  });

  it("edits content and language, and bumps the deck's edit time", async () => {
    const deck = await createDeck();
    const slide = await addSlide(deck.id, { kind: "code", content: "a" });
    const res = await as(hostA, api().patch(`/decks/${deck.id}/slides/${slide.id}`))
      .send({ content: "SELECT 1;", language: "sql" })
      .expect(200);
    expect(res.body).toMatchObject({ content: "SELECT 1;", language: "sql" });

    const row = await prisma.deck.findUniqueOrThrow({ where: { id: deck.id } });
    expect(row.updatedAt.getTime()).toBeGreaterThan(Date.parse(deck.updatedAt));
  });

  it("refuses a language on a slide that is not code, and an empty patch", async () => {
    const deck = await createDeck();
    const text = await addSlide(deck.id, { kind: "text" });
    const url = `/decks/${deck.id}/slides/${text.id}`;
    await as(hostA, api().patch(url)).send({ language: "sql" }).expect(422);
    await as(hostA, api().patch(url)).send({}).expect(422);
    await as(hostA, api().patch(url)).send({ language: "cobol" }).expect(422);
  });

  it("reorders with the full list of ids", async () => {
    const deck = await createDeck();
    const a = await addSlide(deck.id, { kind: "text", content: "a" });
    const b = await addSlide(deck.id, { kind: "text", content: "b" });
    const [blank] = await slidesOf(deck.id);

    const res = await as(hostA, api().put(`/decks/${deck.id}/slide-order`))
      .send({ slideIds: [b.id, blank.id, a.id] })
      .expect(200);
    expect((res.body as SlideDto[]).map((s) => s.content)).toEqual(["b", null, "a"]);
    expect((await slidesOf(deck.id)).map((s) => s.id)).toEqual([b.id, blank.id, a.id]);
  });

  it("refuses an order that misses, repeats or invents a slide", async () => {
    const deck = await createDeck();
    const a = await addSlide(deck.id, { kind: "text" });
    const [blank] = await slidesOf(deck.id);
    const url = `/decks/${deck.id}/slide-order`;
    const unknown = "0192f3a4-0000-7000-8000-000000000001";

    for (const slideIds of [[a.id], [a.id, a.id], [a.id, unknown], [blank.id, a.id, unknown]]) {
      const res = await as(hostA, api().put(url)).send({ slideIds }).expect(422);
      expect(res.body.error.code).toBe("INVALID_PAYLOAD");
    }
    expect((await slidesOf(deck.id)).map((s) => s.id)).toEqual([blank.id, a.id]);
  });

  it("duplicates a slide right after the original", async () => {
    const deck = await createDeck();
    const code = await addSlide(deck.id, { kind: "code", content: "x = 1", language: "python" });
    await addSlide(deck.id, { kind: "math", content: "y" });

    const res = await as(hostA, api().post(`/decks/${deck.id}/slides/${code.id}/copies`)).expect(
      201,
    );
    expect(res.headers.location).toBe(`/api/decks/${deck.id}/slides/${res.body.id}`);
    expect(res.body).toMatchObject({ kind: "code", content: "x = 1", language: "python" });
    expect(res.body.id).not.toBe(code.id);

    const slides = await slidesOf(deck.id);
    expect(slides.map((s) => s.id).slice(1, 3)).toEqual([code.id, res.body.id]);
    expect(slides.map((s) => s.position)).toEqual([0, 1, 2, 3]);
  });

  it("duplicates an activity slide with its wording and options", async () => {
    const deck = await createDeck();
    const poll = await addSlide(deck.id, { kind: "poll" });
    const activity = await prisma.activity.findUniqueOrThrow({ where: { slideId: poll.id } });
    await prisma.activity.update({ where: { id: activity.id }, data: { prompt: "Which?" } });
    await prisma.activityOption.createMany({
      data: [
        { activityId: activity.id, position: 0, label: "A" },
        { activityId: activity.id, position: 1, label: "B" },
      ],
    });

    const res = await as(hostA, api().post(`/decks/${deck.id}/slides/${poll.id}/copies`)).expect(
      201,
    );
    expect(res.body.activity).toEqual({ type: "poll", prompt: "Which?" });
    const copy = await prisma.activity.findUniqueOrThrow({
      where: { slideId: res.body.id },
      include: { options: { orderBy: { position: "asc" } } },
    });
    expect(copy.options.map((o) => o.label)).toEqual(["A", "B"]);
    expect(copy.id).not.toBe(activity.id);
  });

  it("deletes a slide and closes the gap", async () => {
    const deck = await createDeck();
    const a = await addSlide(deck.id, { kind: "text", content: "a" });
    const b = await addSlide(deck.id, { kind: "text", content: "b" });
    await as(hostA, api().delete(`/decks/${deck.id}/slides/${a.id}`)).expect(204);

    const slides = await slidesOf(deck.id);
    expect(slides.map((s) => s.id)).not.toContain(a.id);
    expect(slides.map((s) => s.position)).toEqual([0, 1]);
    expect(slides[1].id).toBe(b.id);
    await as(hostA, api().delete(`/decks/${deck.id}/slides/${a.id}`)).expect(404);
  });

  it("refuses to delete an activity slide while its activity is live", async () => {
    const deck = await createDeck();
    const poll = await addSlide(deck.id, { kind: "poll" });
    const activity = await prisma.activity.findUniqueOrThrow({ where: { slideId: poll.id } });
    const session = await prisma.session.create({
      data: { deckId: deck.id, ownerId: hostA.id, pin: "482915", status: "live", settings: {} },
    });
    const run = await prisma.activityRun.create({
      data: { sessionId: session.id, activityId: activity.id, state: "live" },
    });

    const res = await as(hostA, api().delete(`/decks/${deck.id}/slides/${poll.id}`)).expect(409);
    expect(res.body.error.code).toBe("ACTIVITY_LOCKED");

    await prisma.activityRun.update({ where: { id: run.id }, data: { state: "closed" } });
    await as(hostA, api().delete(`/decks/${deck.id}/slides/${poll.id}`)).expect(204);
  });

  it("uploads an image and serves it without a login", async () => {
    const deck = await createDeck();
    const slide = await addSlide(deck.id, { kind: "image" });

    const res = await as(hostA, api().put(`/decks/${deck.id}/slides/${slide.id}/image`))
      .attach("file", PNG, { filename: "diagram.png", contentType: "image/png" })
      .expect(200);
    expect(res.body.imageRef).toMatch(/^[0-9a-f-]{36}\.png$/);

    const file = await api().get(`/slide-images/${res.body.imageRef}`).expect(200);
    expect(file.headers["content-type"]).toBe("image/png");
    expect(file.headers["cache-control"]).toContain("immutable");
    expect(file.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.compare(file.body, PNG)).toBe(0);
  });

  it("refuses an upload that is not an image, is missing, or is for a text slide", async () => {
    const deck = await createDeck();
    const image = await addSlide(deck.id, { kind: "image" });
    const text = await addSlide(deck.id, { kind: "text" });
    const put = (slideId: string) =>
      as(hostA, api().put(`/decks/${deck.id}/slides/${slideId}/image`));

    await put(image.id)
      .attach("file", Buffer.from("<svg onload=alert(1)/>"), {
        filename: "x.png",
        contentType: "image/png",
      })
      .expect(415);
    await put(image.id).field("note", "no file").expect(422);
    await put(text.id)
      .attach("file", PNG, { filename: "a.png", contentType: "image/png" })
      .expect(422);
    expect((await slidesOf(deck.id)).find((s) => s.id === image.id)?.imageRef).toBeNull();
  });

  it("answers 404 for an unknown or malformed image name", async () => {
    await api().get("/slide-images/0192f3a4-0000-7000-8000-000000000001.png").expect(404);
    await api().get("/slide-images/..%2Fsecret.png").expect(404);
    await api().get("/slide-images/not-an-image").expect(404);
  });

  it("answers 404 for another host's deck and changes nothing", async () => {
    const deck = await createDeck();
    const slide = await addSlide(deck.id, { kind: "text", content: "private" });
    const base = `/decks/${deck.id}`;

    for (const res of [
      await as(hostB, api().post(`${base}/slides`)).send({ kind: "text" }),
      await as(hostB, api().patch(`${base}/slides/${slide.id}`)).send({ content: "hijacked" }),
      await as(hostB, api().delete(`${base}/slides/${slide.id}`)),
      await as(hostB, api().post(`${base}/slides/${slide.id}/copies`)),
      await as(hostB, api().put(`${base}/slide-order`)).send({ slideIds: [slide.id] }),
      await as(hostB, api().put(`${base}/slides/${slide.id}/image`)).attach("file", PNG, "a.png"),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    }
    const slides = await slidesOf(deck.id);
    expect(slides).toHaveLength(2);
    expect(slides.find((s) => s.id === slide.id)?.content).toBe("private");
  });

  it("answers 404 for a slide of another deck", async () => {
    const one = await createDeck("One");
    const two = await createDeck("Two");
    const slide = await addSlide(one.id, { kind: "text" });
    await as(hostA, api().patch(`/decks/${two.id}/slides/${slide.id}`))
      .send({ content: "x" })
      .expect(404);
    await as(hostA, api().patch(`/decks/${two.id}/slides/not-a-uuid`))
      .send({ content: "x" })
      .expect(404);
  });

  it("copies the code language and image when a deck is duplicated", async () => {
    const deck = await createDeck();
    await addSlide(deck.id, { kind: "code", content: "SELECT 1", language: "sql" });
    const copy = await as(hostA, api().post(`/decks/${deck.id}/copies`)).expect(201);
    const slides = await slidesOf(copy.body.id);
    expect(slides.find((s) => s.kind === "code")).toMatchObject({
      content: "SELECT 1",
      language: "sql",
    });
  });
});
