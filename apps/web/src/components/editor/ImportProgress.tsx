"use client";

import { useTranslations } from "next-intl";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import type { PdfImportState } from "@/lib/editor/use-pdf-import";

const KNOWN_CODES = [
  "PDF_INVALID",
  "PDF_PROTECTED",
  "PAGE_RENDER_FAILED",
  "PAGE_TIMEOUT",
  "WORKER_CRASH",
  "ALL_PAGES_FAILED",
] as const;
type KnownCode = (typeof KNOWN_CODES)[number];

/** Why a page or an import failed, in the host's language. */
function useImportErrorText() {
  const t = useTranslations("editor.import.codes");
  return (code: string | null) =>
    t(KNOWN_CODES.includes(code as KnownCode) ? (code as KnownCode) : "unknown");
}

/**
 * MD-15 H02 PDF import status above the editor: reading the file, pages coming in, or what failed
 * and the way to try again. The host keeps editing while it runs.
 */
export function ImportProgress({
  state,
  onRetry,
  onDismiss,
}: {
  state: PdfImportState;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations("editor.import");
  const codeText = useImportErrorText();

  if (state.phase === "idle") return null;

  if (state.phase === "uploading") {
    const percent = state.total ? Math.min(100, Math.floor((state.sent / state.total) * 100)) : 0;
    // Every byte is out: the server reads the PDF before it answers.
    if (percent >= 100) {
      return (
        <Banner tone="info">
          <span
            aria-hidden="true"
            className="size-4 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600 motion-reduce:animate-none"
          />
          {t("checking", { name: state.fileName })}
        </Banner>
      );
    }
    return (
      <div className="flex flex-col gap-1 bg-primary-50 px-4 py-2 text-sm text-primary-700">
        <span className="font-medium">{t("uploading", { name: state.fileName, percent })}</span>
        <div
          role="progressbar"
          aria-label={t("uploadLabel")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1.5 overflow-hidden rounded-full bg-primary-100"
        >
          <div
            className="h-full bg-primary-500 transition-[width] motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    );
  }

  const job = state.import;
  const handled = job.donePages + job.failedPages;

  if (state.phase === "running") {
    return (
      <div className="flex flex-col gap-1 bg-primary-50 px-4 py-2 text-sm text-primary-700">
        <div className="flex flex-wrap items-center gap-x-3">
          <span className="font-medium">
            {t("progress", { name: job.fileName, done: handled, total: job.pageCount })}
          </span>
          <span className="text-primary-600">{t("keepEditing")}</span>
        </div>
        <div
          role="progressbar"
          aria-label={t("progressLabel")}
          aria-valuemin={0}
          aria-valuemax={job.pageCount}
          aria-valuenow={handled}
          className="h-1.5 overflow-hidden rounded-full bg-primary-100"
        >
          <div
            className="h-full bg-primary-500 transition-[width] motion-reduce:transition-none"
            style={{ width: `${job.pageCount ? (handled / job.pageCount) * 100 : 0}%` }}
          />
        </div>
      </div>
    );
  }

  // Finished with nothing wrong: the toast already said so.
  if (job.failedPages === 0) return null;

  const allFailed = job.status === "failed";
  return (
    <Banner tone="warning" className="flex-wrap">
      <span className="mr-auto">
        {allFailed
          ? t("failedAll", { name: job.fileName, reason: codeText(job.errorCode) })
          : t("failedSome", { failed: job.failedPages, total: job.pageCount })}
      </span>
      <Button variant="secondary" onClick={onRetry}>
        {t("retry")}
      </Button>
      <Button variant="ghost" onClick={onDismiss}>
        {t("dismiss")}
      </Button>
    </Banner>
  );
}
