// Starts the import worker (technical design §1: PDF import runs beside `api`, so the Socket.IO
// event loop is not blocked). The worker is a child process, not a worker thread: pdf.js draws with
// a native library, and a native crash (such as SIGILL on a CPU without AVX) ends the whole
// process it runs in. In a child process it ends only the import.

import { fork } from "node:child_process";
import { extname, join } from "node:path";
import type { ImportErrorCode } from "@moddeck/shared";
import type { WorkerJob, WorkerMessage } from "./import.worker";

export interface WorkerHandle {
  /** Resolves when the worker has ended, however it ended. `error` says why when it crashed. */
  exit: Promise<{ code: number; error?: Error }>;
  terminate(): Promise<number>;
}

export function startWorker(
  job: WorkerJob,
  onMessage: (message: WorkerMessage) => void,
): WorkerHandle {
  // Compiled, the worker is a .js file next to this one. Under ts-jest and tsx it is the .ts file,
  // which the child loads through tsx.
  const source = extname(__filename) === ".ts";
  const file = join(__dirname, `import.worker${source ? ".ts" : ".js"}`);
  const child = fork(file, [JSON.stringify(job)], {
    execArgv: source ? ["--require", require.resolve("tsx/cjs")] : [],
    // This module's view of the environment (under jest it is a copy, not the process's own).
    env: process.env,
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  child.on("message", (message) => onMessage(message as WorkerMessage));
  const exit = new Promise<{ code: number; error?: Error }>((resolve) => {
    let error: Error | undefined;
    child.on("error", (e) => (error = e));
    child.on("exit", (code, signal) => {
      if (signal) error ??= new Error(`PDF worker stopped by ${signal}`);
      else if (code) error ??= new Error(`PDF worker exited with code ${code}`);
      resolve({ code: code ?? 1, error });
    });
  });
  return {
    exit,
    terminate: async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      return (await exit).code;
    },
  };
}

const PROBE_TIMEOUT_MS = 20_000;

export type ProbeResult =
  { ok: true; pageCount: number } | { ok: false; code: ImportErrorCode; message: string };

/**
 * Opens the PDF in a short-lived worker: its page count, or why it cannot be imported.
 * `WORKER_CRASH` means the worker itself died, so no PDF can be imported on this server.
 */
export async function probePdf(file: string): Promise<ProbeResult> {
  let result: ProbeResult | undefined;
  let timedOut = false;
  const handle = startWorker({ mode: "probe", file }, (message) => {
    if (message.type === "probed") result = { ok: true, pageCount: message.pageCount };
    if (message.type === "failed")
      result = { ok: false, code: message.code, message: message.message };
  });
  const timer = setTimeout(() => {
    timedOut = true;
    void handle.terminate();
  }, PROBE_TIMEOUT_MS);
  const { error } = await handle.exit;
  clearTimeout(timer);
  if (result) return result;
  if (timedOut) return { ok: false, code: "PDF_INVALID", message: "Reading the PDF took too long" };
  return { ok: false, code: "WORKER_CRASH", message: error?.message ?? "PDF worker stopped" };
}
