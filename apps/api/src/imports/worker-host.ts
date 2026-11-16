// Starts the import worker thread (technical design §1: PDF import runs inside `api`, in a worker
// thread, so the Socket.IO event loop is not blocked).

import { extname, join } from "node:path";
import { Worker } from "node:worker_threads";
import type { ImportErrorCode } from "@moddeck/shared";
import type { WorkerJob, WorkerMessage } from "./import.worker";

export interface WorkerHandle {
  /** Resolves when the thread has ended, however it ended. */
  exit: Promise<{ code: number; error?: Error }>;
  terminate(): Promise<number>;
}

export function startWorker(
  job: WorkerJob,
  onMessage: (message: WorkerMessage) => void,
): WorkerHandle {
  // Compiled, the worker is a .js file next to this one. Under ts-jest and tsx it is the .ts file,
  // which the thread loads through tsx.
  const source = extname(__filename) === ".ts";
  const file = join(__dirname, `import.worker${source ? ".ts" : ".js"}`);
  const worker = source
    ? new Worker(`require("tsx/cjs"); require(${JSON.stringify(file)});`, {
        eval: true,
        workerData: job,
      })
    : new Worker(file, { workerData: job });
  worker.on("message", onMessage);
  const exit = new Promise<{ code: number; error?: Error }>((resolve) => {
    let error: Error | undefined;
    worker.on("error", (e) => (error = e));
    worker.on("exit", (code) => resolve({ code, error }));
  });
  return { exit, terminate: () => worker.terminate() };
}

const PROBE_TIMEOUT_MS = 20_000;

export type ProbeResult =
  { ok: true; pageCount: number } | { ok: false; code: ImportErrorCode; message: string };

/** Opens the PDF in a short-lived thread: its page count, or why it cannot be imported. */
export async function probePdf(file: string): Promise<ProbeResult> {
  let result: ProbeResult | undefined;
  const handle = startWorker({ mode: "probe", file }, (message) => {
    if (message.type === "probed") result = { ok: true, pageCount: message.pageCount };
    if (message.type === "failed")
      result = { ok: false, code: message.code, message: message.message };
  });
  const timer = setTimeout(() => void handle.terminate(), PROBE_TIMEOUT_MS);
  const { error } = await handle.exit;
  clearTimeout(timer);
  return (
    result ?? { ok: false, code: "PDF_INVALID", message: error?.message ?? "PDF cannot be read" }
  );
}
