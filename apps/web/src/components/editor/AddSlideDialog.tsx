"use client";

import { useTranslations } from "next-intl";
import { useRef } from "react";
import type { SlideKind } from "@moddeck/shared";
import { Dialog } from "@/components/ui/Dialog";
import { KindIcon, type TileKind } from "./KindIcon";

/**
 * MD-15 H03 add-slide panel: a blank slide to fill with elements, then the activities. Live Poll
 * and Word Cloud add an activity slide (R1-16 brings the word cloud editor); Q&A is a slot for
 * later.
 */
export function AddSlideDialog({
  onAdd,
  onImportPdf,
  importDisabled = false,
  onClose,
}: {
  onAdd: (kind: SlideKind) => void;
  onImportPdf: (file: File) => void;
  // An import is already running on this deck.
  importDisabled?: boolean;
  onClose: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const t = useTranslations("editor");
  const tCommon = useTranslations("common");

  const tile = (kind: TileKind, label: string, disabled = false) => (
    <li key={kind}>
      <button
        type="button"
        disabled={disabled}
        onClick={kind === "qa" ? undefined : () => onAdd(kind as SlideKind)}
        className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-border bg-background p-3 text-left hover:border-primary-500 hover:bg-primary-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-60"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-neutral-100 text-neutral-700">
          <KindIcon kind={kind} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2 font-semibold">
            {label}
            {disabled && (
              <span className="rounded-full bg-neutral-100 px-2 text-xs font-semibold text-neutral-600">
                {t("add.soon")}
              </span>
            )}
          </span>
          <span className="text-sm text-muted">{t(`add.kindHints.${kind as "content"}`)}</span>
        </span>
      </button>
    </li>
  );

  return (
    <Dialog title={t("add.title")} closeLabel={tCommon("close")} onClose={onClose}>
      <section aria-labelledby="add-content" className="flex flex-col gap-2">
        <h3 id="add-content" className="text-sm font-semibold text-muted">
          {t("add.content")}
        </h3>
        <ul className="flex flex-col gap-2">{tile("content", t("add.blank"))}</ul>
      </section>
      <section aria-labelledby="add-import" className="flex flex-col gap-2">
        <h3 id="add-import" className="text-sm font-semibold text-muted">
          {t("import.section")}
        </h3>
        <ul className="flex flex-col gap-2">
          <li>
            <button
              type="button"
              disabled={importDisabled}
              onClick={() => fileInput.current?.click()}
              className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-border bg-background p-3 text-left hover:border-primary-500 hover:bg-primary-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-60"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-md bg-neutral-100 text-neutral-700">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                  <path d="M14 3v5h5M12 17v-6m-3 3 3-3 3 3" />
                </svg>
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">{t("import.pdf")}</span>
                <span className="text-sm text-muted">
                  {importDisabled ? t("import.busy") : t("import.pdfHint")}
                </span>
              </span>
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,.pdf"
              hidden
              data-testid="pdf-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) onImportPdf(file);
              }}
            />
          </li>
        </ul>
      </section>
      <section aria-labelledby="add-activities" className="flex flex-col gap-2">
        <h3 id="add-activities" className="text-sm font-semibold text-muted">
          {t("add.activities")}
        </h3>
        <ul className="flex flex-col gap-2">
          {tile("poll", t("kinds.poll"))}
          {tile("word_cloud", t("kinds.word_cloud"))}
          {tile("qa", t("add.qa"), true)}
        </ul>
      </section>
    </Dialog>
  );
}
