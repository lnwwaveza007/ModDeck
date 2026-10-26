"use client";

import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { LanguageSwitch } from "./LanguageSwitch";

export type LiveTab = "activity" | "qa";

/**
 * Student live screen frame (MD-15 S06): session header with connection line and menu,
 * the tab content, and the Activity / Q&A tab bar. MD-5 §2.7 puts the language switch
 * in this menu.
 */
export function LiveShell({
  title,
  status,
  activity,
  qa,
}: {
  title: string;
  status?: string;
  activity: ReactNode;
  qa: ReactNode;
}) {
  const t = useTranslations("live");
  const [tab, setTab] = useState<LiveTab>("activity");
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex flex-1 flex-col">
      <header className="relative flex min-h-16 items-center gap-1 border-b border-neutral-200 bg-background py-2 pr-1 pl-4">
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate text-base font-semibold">{title}</p>
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-neutral-400" />
            {status ?? t("connecting")}
          </p>
        </div>
        <button
          type="button"
          aria-label={t("menu")}
          aria-expanded={menuOpen}
          aria-controls="live-menu"
          onClick={() => setMenuOpen((open) => !open)}
          className="grid size-11 shrink-0 place-items-center rounded-md text-neutral-700 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="5" r="1" />
            <circle cx="12" cy="12" r="1" />
            <circle cx="12" cy="19" r="1" />
          </svg>
        </button>
        {menuOpen && (
          <div
            id="live-menu"
            className="absolute top-full right-2 z-10 mt-1 rounded-lg border border-neutral-200 bg-background p-1 shadow-md"
          >
            <LanguageSwitch />
          </div>
        )}
      </header>

      <div className="flex flex-1 flex-col bg-surface">{tab === "activity" ? activity : qa}</div>

      <nav
        aria-label={t("tabs")}
        className="flex border-t border-neutral-200 bg-background px-2 pb-3"
      >
        {(["activity", "qa"] as const).map((key) => (
          <button
            key={key}
            type="button"
            aria-current={tab === key ? "page" : undefined}
            onClick={() => setTab(key)}
            className={cn(
              "relative flex h-15 flex-1 flex-col items-center justify-center gap-1 text-sm focus-visible:outline-2 focus-visible:outline-ring",
              tab === key ? "font-semibold text-primary-700" : "text-muted",
            )}
          >
            {tab === key && (
              <span
                aria-hidden="true"
                className="absolute inset-x-[30%] top-0 h-0.75 rounded-b-sm bg-primary-500"
              />
            )}
            {key === "activity" ? <ActivityIcon /> : <QaIcon />}
            {t(key)}
          </button>
        ))}
      </nav>
    </div>
  );
}

function ActivityIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}

function QaIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
    </svg>
  );
}
