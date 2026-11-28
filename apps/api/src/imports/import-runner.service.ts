import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { ImageElement, ImportErrorCode } from "@moddeck/shared";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { slidesDir } from "../slides/slide-images.service";
import type { WorkerMessage } from "./import.worker";
import { startWorker, type WorkerHandle } from "./worker-host";

const POLL_MS = 2_000;
// One page that takes longer than this is given up, and the rest of the PDF goes on.
export const pageTimeoutMs = () => Number(process.env.IMPORT_PAGE_TIMEOUT_MS ?? 20_000);
// A page gets one more try after a crash of the worker.
const PAGE_TRIES = 2;
const CRASHES_MAX = 3;
// An uploaded PDF that was kept for a retry is removed after this long.
const FILE_KEEP_MS = 24 * 60 * 60 * 1000;
const CLEANUP_MS = 60 * 60 * 1000;

// `IMPORT_RUNNER=off` keeps an api instance from taking jobs. The e2e suites run side by side on one
// database, so only the ones that test the import turn the runner on.
const runnerOff = () => process.env.IMPORT_RUNNER === "off";

export const importsDir = () => process.env.IMPORTS_DIR ?? join(process.cwd(), "data", "imports");

type Outcome =
  | { kind: "done" }
  | { kind: "timeout"; page: number | undefined }
  | { kind: "crash"; page: number | undefined; message: string }
  | { kind: "failed"; code: ImportErrorCode; message: string };

type PageMessage = Extract<WorkerMessage, { type: "page" }>;

/** The page image as one element over the whole 16:9 stage, centred when the page is not 16:9. */
export function fullPageImage(imageRef: string, width: number, height: number): ImageElement {
  const stageRatio = 16 / 9;
  const ratio = width / height;
  const w = ratio >= stageRatio ? 100 : (100 * ratio) / stageRatio;
  const h = ratio >= stageRatio ? (100 * stageRatio) / ratio : 100;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    id: randomUUID(),
    type: "image",
    x: round((100 - w) / 2),
    y: round((100 - h) / 2),
    w: round(w),
    h: round(h),
    imageRef,
  };
}

/**
 * The queue of the PDF import. `pdf_imports` is the queue: the runner takes the oldest queued row,
 * one import at a time, and renders its pages in a child process. A page that finishes is written
 * at once, so the editor shows pages as they come (technical design §3.3).
 */
@Injectable()
export class ImportRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("ImportRunner");
  private timers: NodeJS.Timeout[] = [];
  private active = false;
  private stopped = false;
  private worker?: WorkerHandle;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    if (runnerOff()) return;
    try {
      await this.recover();
    } catch (error) {
      this.logger.error(`Could not recover imports: ${String(error)}`);
    }
    const poll = setInterval(() => void this.tick(), POLL_MS);
    const cleanup = setInterval(() => void this.removeOldFiles(), CLEANUP_MS);
    poll.unref();
    cleanup.unref();
    this.timers.push(poll, cleanup);
    void this.tick();
  }

  async onModuleDestroy() {
    this.stopped = true;
    this.timers.forEach(clearInterval);
    await this.worker?.terminate();
  }

  /** Called after an upload or a retry, so the job starts without waiting for the next poll. */
  kick() {
    void this.tick();
  }

  // An import that was running when the api stopped starts again. Pages that are done stay done.
  private async recover() {
    await this.prisma.pdfImportPage.updateMany({
      where: { status: "running" },
      data: { status: "queued" },
    });
    await this.prisma.pdfImport.updateMany({
      where: { status: "running" },
      data: { status: "queued" },
    });
    await this.removeOldFiles();
  }

  private async removeOldFiles() {
    const old = await this.prisma.pdfImport.findMany({
      where: {
        fileRef: { not: null },
        status: { in: ["done", "failed"] },
        updatedAt: { lt: new Date(Date.now() - FILE_KEEP_MS) },
      },
      select: { id: true, fileRef: true },
    });
    for (const { id, fileRef } of old) {
      if (fileRef) await unlink(join(importsDir(), fileRef)).catch(() => undefined);
      await this.prisma.pdfImport.update({
        where: { id },
        data: { fileRef: null },
        select: { id: true },
      });
    }
  }

  private async tick() {
    if (this.active || this.stopped || runnerOff()) return;
    this.active = true;
    try {
      for (;;) {
        const id = await this.claim();
        if (!id || this.stopped) break;
        await this.process(id).catch((error: unknown) => {
          this.logger.error(`Import ${id} stopped: ${String(error)}`);
          return this.finish(id);
        });
      }
    } catch (error) {
      this.logger.error(`Import queue: ${String(error)}`);
    } finally {
      this.active = false;
    }
  }

  // The oldest queued import, if none is running. SKIP LOCKED keeps a second api instance from
  // taking the same row.
  private async claim(): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE pdf_imports SET status = 'running', updated_at = now()
      WHERE id = (
        SELECT id FROM pdf_imports
        WHERE status = 'queued'
          AND NOT EXISTS (SELECT 1 FROM pdf_imports WHERE status = 'running')
        ORDER BY created_at, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;
    return rows[0]?.id ?? null;
  }

  private async process(importId: string) {
    const job = await this.prisma.pdfImport.findUnique({
      where: { id: importId },
      include: { pages: { where: { status: "queued" }, orderBy: { page: "asc" } } },
    });
    if (!job) return;
    // A page that was started PAGE_TRIES times without an end was running when the api stopped
    // twice. Trying it again could stop the api again.
    const worn = job.pages.filter((p) => p.attempts >= PAGE_TRIES).map((p) => p.page);
    if (worn.length) {
      this.logger.warn(`Import ${importId}: pages ${worn.join(", ")} stopped the api; skipped`);
      await this.failPages(importId, worn, "WORKER_CRASH");
    }
    const pending = new Set(job.pages.filter((p) => p.attempts < PAGE_TRIES).map((p) => p.page));
    if (!job.fileRef) {
      await this.failPages(importId, pending, "PDF_INVALID");
      return this.finish(importId);
    }
    const file = join(importsDir(), job.fileRef);
    const tries = new Map<number, number>();
    let crashes = 0;

    while (pending.size && !this.stopped) {
      const outcome = await this.runWorker(importId, file, pending);
      if (this.stopped) return;
      if (outcome.kind === "failed") {
        this.logger.warn(`Import ${importId}: ${outcome.code} ${outcome.message}`);
        await this.failPages(importId, pending, outcome.code);
        return this.finish(importId, outcome.code);
      }
      if (outcome.kind === "timeout" && outcome.page !== undefined) {
        this.logger.warn(
          `Import ${importId}: page ${outcome.page} took over ${pageTimeoutMs()} ms`,
        );
        await this.failPages(importId, [outcome.page], "PAGE_TIMEOUT");
        pending.delete(outcome.page);
      } else if (outcome.kind === "crash") {
        this.logger.warn(
          `Import ${importId}: worker crashed on page ${outcome.page}: ${outcome.message}`,
        );
        if (outcome.page !== undefined) {
          const n = (tries.get(outcome.page) ?? 0) + 1;
          tries.set(outcome.page, n);
          if (n >= PAGE_TRIES) {
            await this.failPages(importId, [outcome.page], "WORKER_CRASH");
            pending.delete(outcome.page);
          }
        } else if (++crashes >= CRASHES_MAX) {
          await this.failPages(importId, pending, "WORKER_CRASH");
        }
      }
    }
    await this.finish(importId);
  }

  // Runs one worker process over the pending pages. Resolves when the worker is done, crashed,
  // timed out on a page or could not open the file. `pending` loses each page as it is saved.
  private runWorker(importId: string, file: string, pending: Set<number>): Promise<Outcome> {
    return new Promise((resolve) => {
      let current: number | undefined;
      let timer: NodeJS.Timeout | undefined;
      let settled = false;
      let writes: Promise<void> = Promise.resolve();
      const enqueue = (write: () => Promise<void>) => {
        writes = writes.then(write).catch((error: unknown) => {
          this.logger.error(`Import ${importId}: could not save a page: ${String(error)}`);
        });
      };
      const finish = (outcome: Outcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void writes.then(() => resolve(outcome));
      };
      const pages = [...pending].sort((a, b) => a - b);
      const handle = startWorker({ mode: "render", file, pages, slidesDir: slidesDir() }, (m) => {
        switch (m.type) {
          case "start":
            current = m.page;
            clearTimeout(timer);
            timer = setTimeout(() => {
              void handle.terminate();
              finish({ kind: "timeout", page: current });
            }, pageTimeoutMs());
            enqueue(() => this.markRunning(importId, m.page));
            break;
          case "page":
            current = undefined;
            enqueue(async () => {
              try {
                await this.savePage(importId, m);
              } catch (error) {
                // A page the database refuses would be refused again on every try: it fails.
                this.logger.error(
                  `Import ${importId}: could not save page ${m.page}: ${String(error)}`,
                );
                await this.failPages(importId, [m.page], "PAGE_RENDER_FAILED");
              }
              pending.delete(m.page);
            });
            break;
          case "page_failed":
            current = undefined;
            this.logger.warn(`Import ${importId}: page ${m.page}: ${m.message}`);
            enqueue(async () => {
              await this.failPages(importId, [m.page], m.code);
              pending.delete(m.page);
            });
            break;
          case "failed":
            finish({ kind: "failed", code: m.code, message: m.message });
            break;
          case "done":
            finish({ kind: "done" });
            break;
        }
      });
      this.worker = handle;
      void handle.exit.then(({ code, error }) =>
        finish({ kind: "crash", page: current, message: error?.message ?? `exit code ${code}` }),
      );
    });
  }

  private async markRunning(importId: string, page: number) {
    await this.prisma.pdfImportPage.updateMany({
      where: { importId, page, status: "queued" },
      data: { status: "running", attempts: { increment: 1 } },
    });
  }

  private async savePage(importId: string, m: PageMessage) {
    const { page, imageRef, width, height, text, thai } = m;
    // The counters show a new export problem early (MD-14 §6).
    this.logger.log(`Import ${importId} page ${page}: ${JSON.stringify(thai)}`);
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.pdfImportPage.findUnique({
        where: { importId_page: { importId, page } },
      });
      // The host deleted the slide while the page was drawn.
      if (!row) return;
      await tx.slide.update({
        where: { id: row.slideId },
        data: {
          elements: [fullPageImage(imageRef, width, height)] as unknown as Prisma.InputJsonValue,
          imageRef,
          sourceText: text,
        },
        select: { id: true },
      });
      await tx.pdfImportPage.update({
        where: { importId_page: { importId, page } },
        data: { status: "done", errorCode: null },
        select: { page: true },
      });
    });
  }

  private async failPages(importId: string, pages: Iterable<number>, code: ImportErrorCode) {
    await this.prisma.pdfImportPage.updateMany({
      where: { importId, page: { in: [...pages] }, status: { in: ["queued", "running"] } },
      data: { status: "failed", errorCode: code },
    });
  }

  /**
   * Ends the import. It is `failed` only when no page came out. The PDF is kept while a page has
   * failed, so the host can retry it.
   */
  private async finish(importId: string, errorCode?: ImportErrorCode) {
    const pages = await this.prisma.pdfImportPage.findMany({
      where: { importId },
      select: { status: true },
    });
    const failed = pages.filter((p) => p.status === "failed").length;
    const allFailed = pages.length > 0 && failed === pages.length;
    const job = await this.prisma.pdfImport.findUnique({
      where: { id: importId },
      select: { fileRef: true, deckId: true },
    });
    const keep = failed > 0 && !isUnreadable(errorCode);
    if (job?.fileRef && !keep) {
      await unlink(join(importsDir(), job.fileRef)).catch(() => undefined);
    }
    await this.prisma.pdfImport.update({
      where: { id: importId },
      data: {
        status: allFailed ? "failed" : "done",
        errorCode: allFailed ? (errorCode ?? "ALL_PAGES_FAILED") : null,
        ...(job?.fileRef && !keep && { fileRef: null }),
      },
      select: { id: true },
    });
    if (job) {
      await this.prisma.deck.update({
        where: { id: job.deckId },
        data: { updatedAt: new Date() },
        select: { id: true },
      });
    }
  }
}

// A file pdf.js cannot open will not open on a retry either.
const isUnreadable = (code?: ImportErrorCode) => code === "PDF_INVALID" || code === "PDF_PROTECTED";
