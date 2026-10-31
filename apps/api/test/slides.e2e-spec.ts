// Slides of a deck end to end against the real database: add, edit the canvas, reorder, duplicate,
// delete and image upload, each scoped to the deck's owner.

import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { DeckDetail, DeckSummary, SlideDto, SlideElement } from "@moddeck/shared";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma/prisma.service";

const SUBJECTS = ["e2e-slides-host-a", "e2e-slides-host-b"];
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(32)]);

const text = (overrides: Partial<SlideElement> = {}): SlideElement =>
  ({
    id: randomUUID(),
    type: "text",
    x: 8,
    y: 8,
    w: 84,
    text: "# Hello",
    size: 3.4,
    bold: false,
    align: "left",
    ...overrides,
  }) as SlideElement;

const code = (source: string, language = "python"): SlideElement =>
  ({
    id: randomUUID(),
    type: "code",
    x: 5,
    y: 30,
    w: 90,
    code: source,
    language,
    size: 2.2,
  }) as SlideElement;

const math = (latex: string): SlideElement => ({
  id: randomUUID(),
  type: "math",
  x: 8,
  y: 70,
  w: 84,
  latex,
  size: 4.8,
  align: "center",
});

const image = (imageRef: string | null): SlideElement => ({
  id: randomUUID(),
  type: "image",
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  imageRef,
});

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

  const saveElements = (deckId: string, slideId: string, elements: SlideElement[]) =>
    as(hostA, api().patch(`/decks/${deckId}/slides/${slideId}`)).send({ elements });

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
    await api().post(`/decks/${id}/slides`).send({ kind: "content" }).expect(401);
    await api().put(`/decks/${id}/slide-order`).send({ slideIds: [] }).expect(401);
    await api().post(`/decks/${id}/slide-images`).expect(401);
  });

  it("returns the slides with the deck, in order", async () => {
    const deck = await createDeck();
    const res = await as(hostA, api().get(`/decks/${deck.id}`)).expect(200);
    expect(res.body).toMatchObject({ id: deck.id, slideCount: 1 });
    expect(res.body.slides).toMatchObject([{ position: 0, kind: "content", elements: [] }]);
  });

  it("adds a blank content slide, one with elements, and the two activity slides", async () => {
    const deck = await createDeck();
    const blank = await addSlide(deck.id, { kind: "content" });
    const filled = await addSlide(deck.id, { kind: "content", elements: [text(), code("x = 1")] });
    const poll = await addSlide(deck.id, { kind: "poll" });
    const cloud = await addSlide(deck.id, { kind: "word_cloud" });

    expect(blank).toMatchObject({ position: 1, kind: "content", elements: [], activity: null });
    expect(filled.elements.map((e) => e.type)).toEqual(["text", "code"]);
    expect(poll).toMatchObject({
      kind: "poll",
      elements: [],
      activity: { type: "poll", prompt: "" },
    });
    expect(cloud.activity).toEqual({ type: "word_cloud", prompt: "" });
    expect((await slidesOf(deck.id)).map((s) => s.position)).toEqual([0, 1, 2, 3, 4]);
  });

  it("refuses the removed kinds, elements on an activity slide, and a malformed element", async () => {
    const deck = await createDeck();
    const post = (body: object) => as(hostA, api().post(`/decks/${deck.id}/slides`)).send(body);

    for (const kind of ["text", "code", "math", "image"]) await post({ kind }).expect(422);
    await post({ kind: "poll", elements: [] }).expect(422);
    const res = await post({ kind: "content", elements: [{ type: "text" }] }).expect(422);
    expect(res.body.error.code).toBe("INVALID_PAYLOAD");
  });

  it("inserts at a position and pushes later slides down", async () => {
    const deck = await createDeck();
    const b = await addSlide(deck.id, {
      kind: "content",
      elements: [text({ text: "b" } as never)],
    });
    const a = await addSlide(deck.id, {
      kind: "content",
      position: 0,
      elements: [text({ text: "a" } as never)],
    });
    expect(a.position).toBe(0);
    const slides = await slidesOf(deck.id);
    expect(slides.map((s) => s.position)).toEqual([0, 1, 2]);
    expect(slides[0].id).toBe(a.id);
    expect(slides[2].id).toBe(b.id);
  });

  it("saves a canvas with text, code, formula and image, and gives it back unchanged", async () => {
    const deck = await createDeck();
    const slide = await addSlide(deck.id, { kind: "content" });
    const elements = [text(), code("print(1)", "sql"), math("\\frac{a}{b}"), image(null)];

    const res = await saveElements(deck.id, slide.id, elements).expect(200);
    expect(res.body.elements).toEqual(elements);
    expect((await slidesOf(deck.id)).find((s) => s.id === slide.id)?.elements).toEqual(elements);
  });

  it("keeps a 50+ line code block and LaTeX that does not parse", async () => {
    const deck = await createDeck();
    const slide = await addSlide(deck.id, { kind: "content" });
    const source = Array.from({ length: 80 }, (_, i) => `    total += step_${i}(x)  # ${i}`).join(
      "\n",
    );
    const elements = [code(source), math("\\frac{1")];

    await saveElements(deck.id, slide.id, elements).expect(200);
    const saved = (await slidesOf(deck.id)).find((s) => s.id === slide.id)!;
    expect(saved.elements).toEqual(elements);
    expect(saved.elements[0]).toMatchObject({ code: source });
  });

  it("keeps the order of the elements, back to front, and an empty canvas", async () => {
    const deck = await createDeck();
    const slide = await addSlide(deck.id, { kind: "content" });
    const [a, b, c] = [text(), code("b"), math("c")];
    await saveElements(deck.id, slide.id, [c, a, b]).expect(200);
    expect((await slidesOf(deck.id))[1].elements.map((e) => e.id)).toEqual([c.id, a.id, b.id]);

    await saveElements(deck.id, slide.id, []).expect(200);
    expect((await slidesOf(deck.id))[1].elements).toEqual([]);
  });

  it("bumps the deck's edit time when the canvas changes", async () => {
    const deck = await createDeck();
    const slide = await addSlide(deck.id, { kind: "content" });
    await saveElements(deck.id, slide.id, [text()]).expect(200);
    const row = await prisma.deck.findUniqueOrThrow({ where: { id: deck.id } });
    expect(row.updatedAt.getTime()).toBeGreaterThan(Date.parse(deck.updatedAt));
  });

  it("refuses elements outside the rules and changes nothing", async () => {
    const deck = await createDeck();
    const slide = await addSlide(deck.id, { kind: "content", elements: [text()] });
    const url = `/decks/${deck.id}/slides/${slide.id}`;
    const patch = (body: object) => as(hostA, api().patch(url)).send(body);

    for (const body of [
      {},
      { elements: "no" },
      { elements: [text({ x: -5 })] },
      { elements: [text({ w: 400 })] },
      { elements: [{ ...text(), text: "x".repeat(4001) }] },
      { elements: [code("a", "cobol")] },
      { elements: [image("../../etc/passwd")] },
      { elements: [{ ...text(), id: "not-a-uuid" }] },
      { elements: Array.from({ length: 31 }, () => text()) },
    ]) {
      const res = await patch(body).expect(422);
      expect(res.body.error.code).toBe("INVALID_PAYLOAD");
    }
    expect((await slidesOf(deck.id)).find((s) => s.id === slide.id)?.elements).toHaveLength(1);
  });

  it("refuses to put elements on an activity slide", async () => {
    const deck = await createDeck();
    const poll = await addSlide(deck.id, { kind: "poll" });
    const res = await saveElements(deck.id, poll.id, [text()]).expect(422);
    expect(res.body.error.details).toMatchObject({ reason: "not_content" });
  });

  it("reorders with the full list of ids", async () => {
    const deck = await createDeck();
    const a = await addSlide(deck.id, { kind: "content" });
    const b = await addSlide(deck.id, { kind: "poll" });
    const [first] = await slidesOf(deck.id);

    const res = await as(hostA, api().put(`/decks/${deck.id}/slide-order`))
      .send({ slideIds: [b.id, first.id, a.id] })
      .expect(200);
    expect((res.body as SlideDto[]).map((s) => s.id)).toEqual([b.id, first.id, a.id]);
    expect((await slidesOf(deck.id)).map((s) => s.id)).toEqual([b.id, first.id, a.id]);
  });

  it("refuses an order that misses, repeats or invents a slide", async () => {
    const deck = await createDeck();
    const a = await addSlide(deck.id, { kind: "content" });
    const [blank] = await slidesOf(deck.id);
    const url = `/decks/${deck.id}/slide-order`;
    const unknown = "0192f3a4-0000-7000-8000-000000000001";

    for (const slideIds of [[a.id], [a.id, a.id], [a.id, unknown], [blank.id, a.id, unknown]]) {
      const res = await as(hostA, api().put(url)).send({ slideIds }).expect(422);
      expect(res.body.error.code).toBe("INVALID_PAYLOAD");
    }
    expect((await slidesOf(deck.id)).map((s) => s.id)).toEqual([blank.id, a.id]);
  });

  it("duplicates a content slide with its canvas right after the original", async () => {
    const deck = await createDeck();
    const elements = [text(), code("x = 1")];
    const slide = await addSlide(deck.id, { kind: "content", elements });
    await addSlide(deck.id, { kind: "content" });

    const res = await as(hostA, api().post(`/decks/${deck.id}/slides/${slide.id}/copies`)).expect(
      201,
    );
    expect(res.headers.location).toBe(`/api/decks/${deck.id}/slides/${res.body.id}`);
    expect(res.body.elements).toEqual(elements);
    expect(res.body.id).not.toBe(slide.id);

    const slides = await slidesOf(deck.id);
    expect(slides.map((s) => s.id).slice(1, 3)).toEqual([slide.id, res.body.id]);
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
    const a = await addSlide(deck.id, { kind: "content" });
    const b = await addSlide(deck.id, { kind: "content" });
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

  it("stores an uploaded image, serves it without a login, and lets an element point at it", async () => {
    const deck = await createDeck();
    const slide = await addSlide(deck.id, { kind: "content" });

    const upload = await as(hostA, api().post(`/decks/${deck.id}/slide-images`))
      .attach("file", PNG, { filename: "diagram.png", contentType: "image/png" })
      .expect(201);
    const { imageRef } = upload.body;
    expect(imageRef).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(upload.headers.location).toBe(`/api/slide-images/${imageRef}`);

    await saveElements(deck.id, slide.id, [image(imageRef)]).expect(200);

    const file = await api().get(`/slide-images/${imageRef}`).expect(200);
    expect(file.headers["content-type"]).toBe("image/png");
    expect(file.headers["cache-control"]).toContain("immutable");
    expect(file.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.compare(file.body, PNG)).toBe(0);
  });

  it("refuses an upload that is not an image or has no file", async () => {
    const deck = await createDeck();
    const post = () => as(hostA, api().post(`/decks/${deck.id}/slide-images`));

    await post()
      .attach("file", Buffer.from("<svg onload=alert(1)/>"), {
        filename: "x.png",
        contentType: "image/png",
      })
      .expect(415);
    await post().field("note", "no file").expect(422);
  });

  it("answers 404 for an unknown or malformed image name", async () => {
    await api().get("/slide-images/0192f3a4-0000-7000-8000-000000000001.png").expect(404);
    await api().get("/slide-images/..%2Fsecret.png").expect(404);
    await api().get("/slide-images/not-an-image").expect(404);
  });

  it("answers 404 for another host's deck and changes nothing", async () => {
    const deck = await createDeck();
    const slide = await addSlide(deck.id, { kind: "content", elements: [text()] });
    const base = `/decks/${deck.id}`;

    for (const res of [
      await as(hostB, api().post(`${base}/slides`)).send({ kind: "content" }),
      await as(hostB, api().patch(`${base}/slides/${slide.id}`)).send({ elements: [] }),
      await as(hostB, api().delete(`${base}/slides/${slide.id}`)),
      await as(hostB, api().post(`${base}/slides/${slide.id}/copies`)),
      await as(hostB, api().put(`${base}/slide-order`)).send({ slideIds: [slide.id] }),
      await as(hostB, api().post(`${base}/slide-images`)).attach("file", PNG, "a.png"),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    }
    const slides = await slidesOf(deck.id);
    expect(slides).toHaveLength(2);
    expect(slides.find((s) => s.id === slide.id)?.elements).toHaveLength(1);
  });

  it("answers 404 for a slide of another deck or a malformed id", async () => {
    const one = await createDeck("One");
    const two = await createDeck("Two");
    const slide = await addSlide(one.id, { kind: "content" });
    await saveElements(two.id, slide.id, []).expect(404);
    await saveElements(two.id, "not-a-uuid", []).expect(404);
  });

  it("copies the canvas when a deck is duplicated", async () => {
    const deck = await createDeck();
    const elements = [code("SELECT 1", "sql"), math("x^2")];
    await addSlide(deck.id, { kind: "content", elements });
    const copy = await as(hostA, api().post(`/decks/${deck.id}/copies`)).expect(201);
    const slides = await slidesOf(copy.body.id);
    expect(slides.find((s) => s.elements.length === 2)?.elements).toEqual(elements);
  });

  it("migrates slides from before the canvas editor into content slides", async () => {
    const deck = await createDeck();
    const base = { deckId: deck.id };
    const rows = await prisma.$transaction([
      prisma.slide.create({
        data: { ...base, position: 10, kind: "text", content: "# Old title" },
      }),
      prisma.slide.create({ data: { ...base, position: 11, kind: "text" } }),
      prisma.slide.create({ data: { ...base, position: 12, kind: "code", content: "SELECT 1;" } }),
      prisma.slide.create({ data: { ...base, position: 13, kind: "math", content: "x^2" } }),
      prisma.slide.create({
        data: {
          ...base,
          position: 14,
          kind: "image",
          imageRef: "0192f3a4-0000-7000-8000-000000000002.png",
        },
      }),
      prisma.slide.create({ data: { ...base, position: 15, kind: "image" } }),
    ]);

    // Run the conversion from the migration file itself.
    const sql = await readFile(
      join(__dirname, "../prisma/migrations/20261101120100_slide_elements/migration.sql"),
      "utf8",
    );
    await prisma.$executeRawUnsafe(sql.slice(sql.indexOf('UPDATE "slides"')));

    const slides = await slidesOf(deck.id);
    const byId = (id: string) => slides.find((s) => s.id === id)!;
    const [title, emptyText, sql1, formula, picture, emptyImage] = rows.map((r) => byId(r.id));

    for (const slide of [title, emptyText, sql1, formula, picture, emptyImage]) {
      expect(slide.kind).toBe("content");
    }
    expect(title.elements).toMatchObject([{ type: "text", text: "# Old title", w: 84 }]);
    expect(emptyText.elements).toEqual([]);
    expect(sql1.elements).toMatchObject([{ type: "code", code: "SELECT 1;", language: "python" }]);
    expect(formula.elements).toMatchObject([{ type: "math", latex: "x^2", align: "center" }]);
    expect(picture.elements).toMatchObject([{ type: "image", x: 0, y: 0, w: 100, h: 100 }]);
    expect(emptyImage.elements).toEqual([]);
  });
});
