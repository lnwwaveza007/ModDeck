"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ImportDto } from "@moddeck/shared";
import { getImport, listImports, retryImport, uploadPdf } from "@/lib/api/imports";

export type PdfImportState =
  | { phase: "idle" }
  // The file is on its way to the server, which reads it before it answers.
  | { phase: "uploading"; fileName: string }
  // The slides exist; the pages fill in.
  | { phase: "running"; import: ImportDto }
  // Over. Some pages may have failed, or all of them.
  | { phase: "finished"; import: ImportDto };

const POLL_MS = 1000;

const isRunning = (job: ImportDto) => job.status === "queued" || job.status === "running";

/**
 * The PDF import of a deck in the editor (F9). The host keeps editing while it runs: this polls
 * the job once a second and tells the editor when a page has come in (`onSlidesChanged`), so the
 * slides fill in one by one. An import that is still running when the editor opens is picked up.
 */
export function usePdfImport({
  deckId,
  onSlidesChanged,
  onFinished,
}: {
  deckId: string;
  onSlidesChanged: () => void;
  onFinished: (job: ImportDto) => void;
}) {
  const [state, setState] = useState<PdfImportState>({ phase: "idle" });
  const callbacks = useRef({ onSlidesChanged, onFinished });
  useEffect(() => {
    callbacks.current = { onSlidesChanged, onFinished };
  });
  // The job being watched, and how far it had got at the last look.
  const seen = useRef<{ id: string; done: number; failed: number } | null>(null);

  const watch = useCallback((job: ImportDto) => {
    seen.current = { id: job.id, done: job.donePages, failed: job.failedPages };
    setState(
      isRunning(job) ? { phase: "running", import: job } : { phase: "finished", import: job },
    );
  }, []);

  // An import from before this page opened: still running, or finished with pages that failed.
  useEffect(() => {
    let active = true;
    listImports(deckId).then(
      ([latest]) => {
        if (!active || !latest) return;
        if (isRunning(latest) || latest.failedPages > 0) watch(latest);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [deckId, watch]);

  const runningId = state.phase === "running" ? state.import.id : null;
  useEffect(() => {
    if (!runningId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const look = async () => {
      try {
        const job = await getImport(runningId);
        if (!active) return;
        const before = seen.current;
        const moved = !before || before.done !== job.donePages || before.failed !== job.failedPages;
        seen.current = { id: job.id, done: job.donePages, failed: job.failedPages };
        if (isRunning(job)) {
          setState({ phase: "running", import: job });
        } else {
          setState({ phase: "finished", import: job });
          callbacks.current.onSlidesChanged();
          callbacks.current.onFinished(job);
          return;
        }
        if (moved) callbacks.current.onSlidesChanged();
      } catch {
        // A dropped request is tried again at the next look.
      }
      if (active) timer = setTimeout(look, POLL_MS);
    };
    timer = setTimeout(look, POLL_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [runningId]);

  /** Uploads the PDF. Rejects with the ApiError when the server refuses it. */
  const start = useCallback(
    async (file: File) => {
      setState({ phase: "uploading", fileName: file.name });
      try {
        const job = await uploadPdf(deckId, file);
        watch(job);
        callbacks.current.onSlidesChanged();
      } catch (error) {
        setState({ phase: "idle" });
        throw error;
      }
    },
    [deckId, watch],
  );

  /** Failed pages go through the queue again. */
  const retry = useCallback(async () => {
    if (state.phase !== "finished") return;
    const job = await retryImport(state.import.id);
    watch(job);
    callbacks.current.onSlidesChanged();
  }, [state, watch]);

  const dismiss = useCallback(() => setState({ phase: "idle" }), []);

  return {
    state,
    start,
    retry,
    dismiss,
    busy: state.phase === "uploading" || state.phase === "running",
  };
}
