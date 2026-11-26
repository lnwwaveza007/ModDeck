// Child process of the PDF import (started by worker-host.ts, the job in argv[2]). One message per
// finished page goes back to the runner, so the editor shows pages as they finish. The child writes
// the image files itself.

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImportErrorCode } from "@moddeck/shared";
import { openPdf, PdfError, renderPage, type OpenPdf, type RenderedPage } from "./pdf-engine";

export type WorkerJob =
  | { mode: "probe"; file: string }
  | { mode: "render"; file: string; pages: number[]; slidesDir: string };

export type WorkerMessage =
  | { type: "probed"; pageCount: number }
  | { type: "start"; page: number }
  | {
      type: "page";
      page: number;
      imageRef: string;
      width: number;
      height: number;
      text: string;
      thai: RenderedPage["thai"];
    }
  | { type: "page_failed"; page: number; code: ImportErrorCode; message: string }
  | { type: "failed"; code: ImportErrorCode; message: string }
  | { type: "done" };

const channel = process.send?.bind(process);
if (!channel) throw new Error("import.worker must run as a child process with an IPC channel");
// Messages go out in order. The promise settles once this one is written to the channel.
const send = (message: WorkerMessage) =>
  new Promise<void>((resolve) => channel(message, () => resolve()));
// The api went away: nobody reads the pages any more.
process.on("disconnect", () => process.exit(0));

async function run(job: WorkerJob) {
  let pdf: OpenPdf;
  try {
    pdf = await openPdf(job.file);
  } catch (error) {
    const e = error instanceof PdfError ? error : new PdfError("PDF_INVALID", String(error));
    return send({ type: "failed", code: e.code, message: e.message });
  }
  try {
    if (job.mode === "probe") return send({ type: "probed", pageCount: pdf.pageCount });
    await mkdir(job.slidesDir, { recursive: true });
    for (const page of job.pages) {
      void send({ type: "start", page });
      try {
        const rendered = await renderPage(pdf, page);
        const imageRef = `${randomUUID()}.webp`;
        await writeFile(join(job.slidesDir, imageRef), rendered.image, { flag: "wx" });
        const { width, height, text, thai } = rendered;
        void send({ type: "page", page, imageRef, width, height, text, thai });
      } catch (error) {
        void send({
          type: "page_failed",
          page,
          code: "PAGE_RENDER_FAILED",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    await send({ type: "done" });
  } finally {
    await pdf.close().catch(() => undefined);
  }
}

run(JSON.parse(process.argv[2] ?? "{}") as WorkerJob)
  .catch((error: unknown) =>
    send({
      type: "failed",
      code: "PDF_INVALID",
      message: error instanceof Error ? error.message : String(error),
    }),
  )
  // Every message is out: closing the channel lets the child exit.
  .finally(() => process.disconnect());
