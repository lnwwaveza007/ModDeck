"use client";

import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import type { SaveQueue } from "@/lib/editor/save-queue";

/** "Saving…", "Saved" or "Could not save" with a retry, kept up to date by the save queue. */
export function SaveIndicator({ queue }: { queue: SaveQueue }) {
  const t = useTranslations("editor.save");
  const status = useSyncExternalStore(
    queue.subscribe,
    () => queue.status,
    () => "saved" as const,
  );

  return (
    <p
      role="status"
      aria-live="polite"
      data-status={status}
      className={cn(
        "flex min-h-11 items-center gap-2 text-sm",
        status === "error" ? "font-semibold text-error-700" : "text-muted",
      )}
    >
      {status === "saving" && (
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-primary-100 border-t-primary-500 motion-reduce:animate-none"
        />
      )}
      {status === "saved" && (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="text-success-700"
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      )}
      <span>{t(status)}</span>
      {status === "error" && (
        <button
          type="button"
          onClick={() => void queue.retry()}
          className="h-11 rounded-md px-2 font-semibold underline hover:bg-error-50 focus-visible:outline-2 focus-visible:outline-ring"
        >
          {t("retry")}
        </button>
      )}
    </p>
  );
}
