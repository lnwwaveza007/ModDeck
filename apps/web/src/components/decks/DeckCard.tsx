"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import type { DeckSummary } from "@moddeck/shared";
import { cn } from "@/lib/cn";

const formatPin = (pin: string) => `${pin.slice(0, 3)} ${pin.slice(3)}`;

/**
 * MD-15 H01 deck card: slide-shaped thumbnail with the title, then name, facts and actions.
 * A live deck gets the rose ring, the LIVE badge, its PIN and a link back to the presenter.
 */
export function DeckCard({
  deck,
  now,
  onRename,
  onDuplicate,
  onDelete,
}: {
  deck: DeckSummary;
  now: Date;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("decks");
  const tHost = useTranslations("host");
  const format = useFormatter();
  const [live] = deck.liveSessions;
  const liveCount = deck.liveSessions.length;

  return (
    <article
      className={cn(
        "relative flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-background",
        live && "ring-2 ring-error-600",
      )}
    >
      <div
        className={cn(
          "flex aspect-video flex-col justify-end gap-1 border-b border-neutral-200 p-4",
          live ? "bg-primary-50" : "bg-neutral-100",
        )}
      >
        {live && (
          <span className="mb-auto inline-flex h-6 items-center gap-1.5 self-start rounded-full bg-error-600 px-2 text-xs font-bold text-white">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-white" />
            {liveCount > 1 ? t("liveCount", { count: liveCount }) : tHost("live")}
          </span>
        )}
        <p aria-hidden="true" className="line-clamp-2 text-base leading-snug font-bold">
          {deck.title}
        </p>
      </div>

      <div className="flex items-start gap-2 py-3 pr-2 pl-3.5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* Stretched link: the whole card opens the editor; the menu sits above it. */}
          <Link
            href={`/decks/${deck.id}`}
            className="truncate font-bold text-foreground after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring"
          >
            {deck.title}
          </Link>
          <p className="text-sm text-muted">
            {[
              t("slides", { count: deck.slideCount }),
              live
                ? t("pin", { pin: formatPin(live.pin) })
                : t("edited", { when: format.relativeTime(new Date(deck.updatedAt), now) }),
              !live && t("sessions", { count: deck.sessionCount }),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {live && (
            <Link
              href={`/host/${live.id}`}
              className="relative z-10 mt-1.5 self-start text-sm font-semibold text-primary-700 hover:text-primary-800 hover:underline"
            >
              {t("backToSession")} →
            </Link>
          )}
        </div>
        <DeckMenu
          label={t("actions", { title: deck.title })}
          deleteBlocked={Boolean(live)}
          onRename={onRename}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      </div>
    </article>
  );
}

function DeckMenu({
  label,
  deleteBlocked,
  onRename,
  onDuplicate,
  onDelete,
}: {
  label: string;
  deleteBlocked: boolean;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("decks");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const hintId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  const itemClass =
    "flex h-11 w-full items-center px-3 text-left text-sm font-medium hover:bg-neutral-100 focus-visible:bg-neutral-100 focus-visible:outline-none disabled:pointer-events-none disabled:text-neutral-400";

  return (
    <div ref={rootRef} className="relative z-10">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className="grid size-11 place-items-center rounded-md text-neutral-700 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open && (
        <div
          id={menuId}
          className="absolute right-0 bottom-full mb-1 flex w-52 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-background py-1 shadow-md"
        >
          <button type="button" className={itemClass} onClick={pick(onRename)}>
            {t("rename")}
          </button>
          <button type="button" className={itemClass} onClick={pick(onDuplicate)}>
            {t("duplicate")}
          </button>
          <button
            type="button"
            className={cn(itemClass, "text-error-700")}
            disabled={deleteBlocked}
            aria-describedby={deleteBlocked ? hintId : undefined}
            onClick={pick(onDelete)}
          >
            {t("delete")}
          </button>
          {deleteBlocked && (
            <p id={hintId} className="px-3 pt-0.5 pb-2 text-xs text-muted">
              {t("deleteBlocked")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
