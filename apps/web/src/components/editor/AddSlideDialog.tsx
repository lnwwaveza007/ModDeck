"use client";

import { useTranslations } from "next-intl";
import { ACTIVITY_SLIDE_KINDS, CONTENT_SLIDE_KINDS, type SlideKind } from "@moddeck/shared";
import { Dialog } from "@/components/ui/Dialog";
import { KindIcon, type TileKind } from "./KindIcon";

/**
 * MD-15 H03 add-slide panel: content slides first, then activities. Live Poll and Word Cloud add
 * an activity slide now (R1-13 and R1-16 bring their editors); Q&A is a slot for later.
 */
export function AddSlideDialog({
  onAdd,
  onClose,
}: {
  onAdd: (kind: SlideKind) => void;
  onClose: () => void;
}) {
  const t = useTranslations("editor");
  const tCommon = useTranslations("common");

  const tile = (kind: TileKind, label: string, disabled = false) => (
    <li key={kind}>
      <button
        type="button"
        disabled={disabled}
        onClick={kind === "qa" ? undefined : () => onAdd(kind)}
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
          <span className="text-sm text-muted">{t(`add.kindHints.${kind}`)}</span>
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
        <ul className="flex flex-col gap-2">
          {CONTENT_SLIDE_KINDS.map((kind) => tile(kind, t(`kinds.${kind}`)))}
        </ul>
      </section>
      <section aria-labelledby="add-activities" className="flex flex-col gap-2">
        <h3 id="add-activities" className="text-sm font-semibold text-muted">
          {t("add.activities")}
        </h3>
        <ul className="flex flex-col gap-2">
          {ACTIVITY_SLIDE_KINDS.map((kind) => tile(kind, t(`kinds.${kind}`)))}
          {tile("qa", t("add.qa"), true)}
        </ul>
      </section>
    </Dialog>
  );
}
