// Worker thread of the PDF import. One message per finished page goes back to the runner, so the
// editor shows pages as they finish. The thread writes the image files itself.

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
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

const port = parentPort;
if (!port) throw new Error("import.worker must run as a worker thread");
const send = (message: WorkerMessage) => port.postMessage(message);

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
      send({ type: "start", page });
      try {
        const rendered = await renderPage(pdf, page);
        const imageRef = `${randomUUID()}.webp`;
        await writeFile(join(job.slidesDir, imageRef), rendered.image, { flag: "wx" });
        const { width, height, text, thai } = rendered;
        send({ type: "page", page, imageRef, width, height, text, thai });
      } catch (error) {
        send({
          type: "page_failed",
          page,
          code: "PAGE_RENDER_FAILED",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    send({ type: "done" });
  } finally {
    await pdf.close().catch(() => undefined);
  }
}

run(workerData as WorkerJob).catch((error: unknown) => {
  send({
    type: "failed",
    code: "PDF_INVALID",
    message: error instanceof Error ? error.message : String(error),
  });
});
