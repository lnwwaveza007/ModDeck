// PDF import end to end against the real database (F9, MD-14). The first block uses the real worker
// thread: upload, pages that fill in, and the errors a host can meet. The second block replaces the
// worker with a script, to see what the runner does when it crashes or hangs. One file, because
// every app in a test process polls the same queue.

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { DeckDetail, DeckSummary, ImportDetail, ImportDto } from "@moddeck/shared";
import type { WorkerJob, WorkerMessage } from "../src/imports/import.worker";
import type { WorkerHandle } from "../src/imports/worker-host";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { corruptPdf, protectedPdf, textPdf } from "./pdf-fixtures";

type Emit = (message: WorkerMessage) => void;
type Script = (job: WorkerJob, emit: Emit, exit: (code: number) => void) => void;

// `mock` prefix: jest allows these in the factory below.
let mockScript: Script | null = null;
const mockJobs: WorkerJob[] = [];
let mockPageCount = 3;
const mockActual = () =>
  jest.requireActual<typeof import("../src/imports/worker-host")>("../src/imports/worker-host");

jest.mock("../src/imports/worker-host", () => ({
  probePdf: async (file: string) =>
    mockScript ? { ok: true, pageCount: mockPageCount } : mockActual().probePdf(file),
  startWorker: (job: WorkerJob, onMessage: Emit): WorkerHandle => {
    const script = mockScript;
    if (!script) return mockActual().startWorker(job, onMessage);
    mockJobs.push(job);
    let resolve!: (value: { code: number }) => void;
    const exit = new Promise<{ code: number }>((r) => (resolve = r));
    // The thread starts after the caller has the handle, like a real one.
    setTimeout(() => script(job, onMessage, (code) => resolve({ code })), 5);
    return { exit, terminate: async () => (resolve({ code: 1 }), 1) };
  },
}));

const SUBJECTS = ["e2e-import-host-a", "e2e-import-host-b"];

describe("pdf import (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let dir: string;
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

  async function createDeck(): Promise<DeckSummary> {
    return (await as(hostA, api().post("/decks")).send({ title: "Import deck" }).expect(201)).body;
  }

  const upload = (deckId: string, file: Buffer, name = "lecture.pdf", host = hostA) =>
    as(host, api().post(`/decks/${deckId}/imports`)).attach("file", file, {
      filename: name,
      contentType: "application/pdf",
    });

  async function waitFor(importId: string, until: (i: ImportDetail) => boolean) {
    for (let i = 0; i < 150; i++) {
      const res = await as(hostA, api().get(`/imports/${importId}`)).expect(200);
      if (until(res.body as ImportDetail)) return res.body as ImportDetail;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("import did not finish");
  }
  const finished = (i: ImportDetail) => i.status === "done" || i.status === "failed";

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "moddeck-e2e-import-"));
    process.env.SLIDES_DIR = join(dir, "slides");
    process.env.IMPORTS_DIR = join(dir, "imports");
    process.env.IMPORT_RUNNER = "on";
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
    delete process.env.IMPORTS_DIR;
    process.env.IMPORT_RUNNER = "off";
    await rm(dir, { recursive: true, force: true });
  });

  it("needs a host login", async () => {
    const id = "0192f3a4-0000-7000-8000-000000000001";
    await api().post(`/decks/${id}/imports`).expect(401);
    await api().get(`/decks/${id}/imports`).expect(401);
    await api().get(`/imports/${id}`).expect(401);
    await api().post(`/imports/${id}/retries`).expect(401);
  });

  it("turns each page into one image slide and keeps the page text", async () => {
    const deck = await createDeck();
    const res = await upload(deck.id, textPdf(["First page", "Second page", "Third page"])).expect(
      202,
    );
    const started = res.body as ImportDto;
    expect(res.headers.location).toBe(`/api/imports/${started.id}`);
    expect(started).toMatchObject({ fileName: "lecture.pdf", pageCount: 3, deckId: deck.id });

    // The slides exist at once and wait for their page.
    const early = (await as(hostA, api().get(`/decks/${deck.id}`)).expect(200)).body as DeckDetail;
    // A new deck starts with one empty slide; the pages follow it.
    expect(early.slides).toHaveLength(4);

    const done = await waitFor(started.id, finished);
    expect(done).toMatchObject({ status: "done", donePages: 3, failedPages: 0, errorCode: null });

    const all = (await as(hostA, api().get(`/decks/${deck.id}`)).expect(200)).body as DeckDetail;
    const slides = all.slides.slice(1);
    expect(all.slides.map((s) => s.position)).toEqual([0, 1, 2, 3]);
    for (const slide of slides) {
      expect(slide.importStatus ?? null).toBeNull();
      expect(slide.elements).toHaveLength(1);
      expect(slide.elements[0]).toMatchObject({ type: "image", x: 0, y: 0, w: 100, h: 100 });
    }
    const rows = await prisma.slide.findMany({
      where: { deckId: deck.id },
      orderBy: { position: "asc" },
    });
    expect(rows.slice(1).map((r) => r.sourceText)).toEqual([
      "First page",
      "Second page",
      "Third page",
    ]);

    // The image is WebP and the slide-images route serves it.
    const ref = (slides[0].elements[0] as { imageRef: string }).imageRef;
    expect(ref).toMatch(/\.webp$/);
    const image = await api().get(`/slide-images/${ref}`).expect(200);
    expect(image.headers["content-type"]).toBe("image/webp");

    // The uploaded PDF is removed once every page is done.
    expect(await readdir(process.env.IMPORTS_DIR!)).toEqual([]);
    const list = (await as(hostA, api().get(`/decks/${deck.id}/imports`)).expect(200))
      .body as ImportDto[];
    expect(list.map((i) => i.id)).toEqual([started.id]);
  });

  it("fits a page that is not 16:9 inside the slide", async () => {
    const deck = await createDeck();
    const { body } = await upload(deck.id, textPdf(["Four by three"], [800, 600])).expect(202);
    await waitFor(body.id, finished);
    const { slides } = (await as(hostA, api().get(`/decks/${deck.id}`)).expect(200))
      .body as DeckDetail;
    const element = slides[1].elements[0] as { x: number; y: number; w: number; h: number };
    expect(element.h).toBe(100);
    expect(element.w).toBeCloseTo(75, 1);
    expect(element.x).toBeCloseTo(12.5, 1);
  });

  it("adds the pages after the slides the deck already has", async () => {
    const deck = await createDeck();
    await as(hostA, api().post(`/decks/${deck.id}/slides`))
      .send({ kind: "content" })
      .expect(201);
    const { body } = await upload(deck.id, textPdf(["A", "B"])).expect(202);
    await waitFor(body.id, finished);
    const { slides } = (await as(hostA, api().get(`/decks/${deck.id}`)).expect(200))
      .body as DeckDetail;
    expect(slides.map((s) => s.position)).toEqual([0, 1, 2, 3]);
    expect(slides[0].elements).toEqual([]);
    expect(slides[2].elements).toHaveLength(1);
  });

  it("keeps the editor usable while the import runs", async () => {
    const deck = await createDeck();
    const { body } = await upload(
      deck.id,
      textPdf(Array.from({ length: 8 }, (_, i) => `P${i}`)),
    ).expect(202);
    // Adding a slide and reading the deck do not wait for the job.
    await as(hostA, api().post(`/decks/${deck.id}/slides`))
      .send({ kind: "content" })
      .expect(201);
    await as(hostA, api().get(`/decks/${deck.id}`)).expect(200);
    // A second upload waits for the first; so does a live session.
    await upload(deck.id, textPdf(["X"])).expect(409);
    await as(hostA, api().post(`/decks/${deck.id}/sessions`)).expect(409);
    await waitFor(body.id, finished);
  });

  it("refuses a slide edit while its page is still queued", async () => {
    const deck = await createDeck();
    const { body } = await upload(
      deck.id,
      textPdf(Array.from({ length: 6 }, (_, i) => `Q${i}`)),
    ).expect(202);
    const { slides } = (await as(hostA, api().get(`/decks/${deck.id}`)).expect(200))
      .body as DeckDetail;
    const last = slides[slides.length - 1];
    if (last.importStatus === "pending") {
      const res = await as(hostA, api().patch(`/decks/${deck.id}/slides/${last.id}`))
        .send({ elements: [] })
        .expect(409);
      expect(res.body.error.code).toBe("IMPORT_RUNNING");
    }
    await waitFor(body.id, finished);
  });

  describe("errors", () => {
    it("answers 415 for a file that is not a PDF", async () => {
      const deck = await createDeck();
      const res = await upload(deck.id, Buffer.from("just text"), "notes.pdf").expect(415);
      expect(res.body.error).toMatchObject({
        code: "INVALID_PAYLOAD",
        details: { reason: "not_pdf" },
      });
      expect(await prisma.slide.count({ where: { deckId: deck.id } })).toBe(1);
    });

    it("answers 422 for a corrupt PDF", async () => {
      const deck = await createDeck();
      const res = await upload(deck.id, corruptPdf()).expect(422);
      expect(res.body.error.details).toMatchObject({ reason: "corrupt" });
      expect(await prisma.slide.count({ where: { deckId: deck.id } })).toBe(1);
    });

    it("answers 422 for a password-protected PDF", async () => {
      const deck = await createDeck();
      const res = await upload(deck.id, protectedPdf()).expect(422);
      expect(res.body.error.details).toMatchObject({ reason: "protected" });
    });

    it("answers 422 when no file is sent", async () => {
      const deck = await createDeck();
      await as(hostA, api().post(`/decks/${deck.id}/imports`)).expect(422);
    });

    it("leaves no uploaded file behind after an error", async () => {
      expect(await readdir(process.env.IMPORTS_DIR!)).toEqual([]);
    });

    it("answers 404 for another host's deck and import", async () => {
      const deck = await createDeck();
      await upload(deck.id, textPdf(["x"]), "x.pdf", hostB).expect(404);
      const { body } = await upload(deck.id, textPdf(["x"])).expect(202);
      await waitFor(body.id, finished);
      await as(hostB, api().get(`/imports/${body.id}`)).expect(404);
      await as(hostB, api().get(`/decks/${deck.id}/imports`)).expect(404);
      await as(hostB, api().post(`/imports/${body.id}/retries`)).expect(404);
      await as(hostA, api().get("/imports/not-a-uuid")).expect(404);
    });

    it("answers 422 to a retry when no page failed", async () => {
      const deck = await createDeck();
      const { body } = await upload(deck.id, textPdf(["x"])).expect(202);
      await waitFor(body.id, finished);
      const res = await as(hostA, api().post(`/imports/${body.id}/retries`)).expect(422);
      expect(res.body.error.details).toMatchObject({ reason: "nothing_to_retry" });
    });
  });

  it("starts an import that was running again after a restart", async () => {
    const deck = await createDeck();
    const { body } = await upload(deck.id, textPdf(["a", "b"])).expect(202);
    await waitFor(body.id, finished);
    // The api stopped while the import ran: the row says running, the PDF is still kept.
    const pdf = textPdf(["a", "b"]);
    const stuck = await prisma.pdfImport.create({
      data: {
        deckId: deck.id,
        fileName: "again.pdf",
        fileRef: "stuck.pdf",
        pageCount: 1,
        status: "running",
      },
    });
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(process.env.IMPORTS_DIR!, { recursive: true });
    await writeFile(join(process.env.IMPORTS_DIR!, "stuck.pdf"), pdf);
    const slide = await prisma.slide.create({
      data: { deckId: deck.id, position: 9, kind: "content" },
    });
    await prisma.pdfImportPage.create({
      data: { importId: stuck.id, page: 1, slideId: slide.id, status: "running" },
    });

    const { ImportRunnerService } = await import("../src/imports/import-runner.service");
    const runner = app.get(ImportRunnerService) as unknown as { recover(): Promise<void> };
    await runner.recover();
    const done = await waitFor(stuck.id, finished);
    expect(done).toMatchObject({ status: "done", donePages: 1 });
    const text = await prisma.slide.findUniqueOrThrow({ where: { id: slide.id } });
    expect(text.sourceText).toBe("a");
    expect(
      (await readFile(join(process.env.SLIDES_DIR!, text.imageRef ?? ""))).length,
    ).toBeGreaterThan(0);
  });
});

const RUNNER_SUBJECT = "e2e-import-runner-host";
const IMAGE = "00000000-0000-4000-8000-000000000001.webp";

const ok = (page: number): WorkerMessage => ({
  type: "page",
  page,
  imageRef: IMAGE,
  width: 1920,
  height: 1080,
  text: `text ${page}`,
  thai: {
    thaiChars: 0,
    saraAm: 0,
    orphanMarks: 0,
    puaChars: 0,
    replacementChars: 0,
    spaceBeforeSaraAa: 0,
  },
});

// Renders every page of the job, except those where `fail` says what to do.
function worker(fail: (page: number, attempt: number) => "crash" | "hang" | undefined): Script {
  const attempts = new Map<number, number>();
  return (job, emit, exit) => {
    if (job.mode !== "render") return;
    for (const page of job.pages) {
      emit({ type: "start", page });
      const attempt = (attempts.get(page) ?? 0) + 1;
      attempts.set(page, attempt);
      const what = fail(page, attempt);
      if (what === "crash") return exit(1);
      if (what === "hang") return; // only terminate() ends it
      emit(ok(page));
    }
    emit({ type: "done" });
    exit(0);
  };
}

describe("pdf import runner faults (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let dir: string;
  let cookie: string;

  const api = () => request(app.getHttpServer());

  async function cleanup() {
    const users = await prisma.user.findMany({ where: { ssoSubject: RUNNER_SUBJECT } });
    const ownerId = { in: users.map((u) => u.id) };
    await prisma.deck.deleteMany({ where: { ownerId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  }

  async function startImport(): Promise<ImportDetail> {
    const deck: DeckSummary = (
      await api().post("/decks").set("Cookie", cookie).send({ title: "Runner deck" }).expect(201)
    ).body;
    const res = await api()
      .post(`/decks/${deck.id}/imports`)
      .set("Cookie", cookie)
      .attach("file", textPdf(["x"]), { filename: "a.pdf", contentType: "application/pdf" })
      .expect(202);
    return waitFor(res.body.id, (i) => i.status === "done" || i.status === "failed");
  }

  async function waitFor(importId: string, until: (i: ImportDetail) => boolean) {
    for (let i = 0; i < 100; i++) {
      const res = await api().get(`/imports/${importId}`).set("Cookie", cookie).expect(200);
      if (until(res.body)) return res.body as ImportDetail;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("import did not finish");
  }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "moddeck-e2e-runner-"));
    process.env.SLIDES_DIR = join(dir, "slides");
    process.env.IMPORTS_DIR = join(dir, "imports");
    process.env.IMPORT_RUNNER = "on";
    process.env.IMPORT_PAGE_TIMEOUT_MS = "150";
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    await cleanup();
    const auth = app.get(AuthService);
    const user = await auth.upsertUser({
      subject: RUNNER_SUBJECT,
      email: `${RUNNER_SUBJECT}@kmutt.ac.th`,
      displayName: RUNNER_SUBJECT,
      studentId: null,
    });
    cookie = `host_session=${encodeURIComponent((await auth.createSession(user)).token)}`;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
    for (const key of ["SLIDES_DIR", "IMPORTS_DIR", "IMPORT_PAGE_TIMEOUT_MS"])
      delete process.env[key];
    await rm(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // A failed page keeps its PDF for a retry; start each case with none.
    await rm(process.env.IMPORTS_DIR!, { recursive: true, force: true });
    mockJobs.length = 0;
    mockPageCount = 3;
  });

  it("tries a page again after the worker crashes on it", async () => {
    mockScript = worker((page, attempt) => (page === 2 && attempt === 1 ? "crash" : undefined));
    const result = await startImport();
    expect(result).toMatchObject({ status: "done", donePages: 3, failedPages: 0 });
    // The second thread starts at the page that crashed.
    expect(mockJobs.map((j) => j.mode === "render" && j.pages)).toEqual([
      [1, 2, 3],
      [2, 3],
    ]);
    expect(await readdir(process.env.IMPORTS_DIR!)).toEqual([]);
  });

  it("fails one page that crashes twice and finishes the others", async () => {
    mockScript = worker((page) => (page === 2 ? "crash" : undefined));
    const result = await startImport();
    expect(result).toMatchObject({ status: "done", donePages: 2, failedPages: 1 });
    expect(result.pages.map((p) => [p.status, p.errorCode])).toEqual([
      ["done", null],
      ["failed", "WORKER_CRASH"],
      ["done", null],
    ]);
    // The PDF stays so the host can retry.
    expect(await readdir(process.env.IMPORTS_DIR!)).toHaveLength(1);
    const slide = await prisma.slide.findUniqueOrThrow({ where: { id: result.pages[1].slideId } });
    expect(slide.sourceText).toBeNull();

    // Retry runs only the failed page and removes the PDF at the end.
    mockScript = worker(() => undefined);
    mockJobs.length = 0;
    await api().post(`/imports/${result.id}/retries`).set("Cookie", cookie).expect(202);
    const retried = await waitFor(result.id, (i) => i.status === "done" && i.failedPages === 0);
    expect(retried.donePages).toBe(3);
    expect(mockJobs.map((j) => j.mode === "render" && j.pages)).toEqual([[2]]);
    expect(await readdir(process.env.IMPORTS_DIR!)).toEqual([]);
  });

  it("gives up on a page that takes too long and goes on", async () => {
    mockScript = worker((page) => (page === 1 ? "hang" : undefined));
    const result = await startImport();
    expect(result).toMatchObject({ status: "done", donePages: 2, failedPages: 1 });
    expect(result.pages[0]).toMatchObject({ status: "failed", errorCode: "PAGE_TIMEOUT" });
  });

  it("fails the import when every page fails", async () => {
    mockPageCount = 2;
    mockScript = worker(() => "crash");
    const result = await startImport();
    expect(result).toMatchObject({
      status: "failed",
      errorCode: "ALL_PAGES_FAILED",
      failedPages: 2,
    });
  });

  it("fails the import with the reason when the worker cannot open the file", async () => {
    mockScript = (_job, emit, exit) => {
      emit({ type: "failed", code: "PDF_INVALID", message: "Invalid PDF structure" });
      exit(0);
    };
    const result = await startImport();
    expect(result).toMatchObject({ status: "failed", errorCode: "PDF_INVALID", failedPages: 3 });
    // A file that cannot be opened is not kept for a retry.
    expect(await readdir(process.env.IMPORTS_DIR!)).toEqual([]);
  });

  it("does not save a page whose slide the host deleted", async () => {
    mockScript = (job, emit, exit) => {
      if (job.mode !== "render") return;
      emit({ type: "start", page: 1 });
      // The slide of page 2 is deleted before its page arrives.
      void prisma.slide.deleteMany({ where: { importPage: { page: 2 } } }).then(() => {
        for (const page of job.pages) emit(ok(page));
        emit({ type: "done" });
        exit(0);
      });
    };
    const result = await startImport();
    expect(result.status).toBe("done");
    expect(result.pages.map((p) => p.page)).toEqual([1, 3]);
  });
});
