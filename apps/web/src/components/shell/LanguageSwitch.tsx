"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { setLocale } from "@/lib/i18n/actions";
import { cn } from "@/lib/cn";

/** "ไทย · EN" button from MD-15 S03. Flips the UI language and remembers it in a cookie. */
export function LanguageSwitch({ className }: { className?: string }) {
  const t = useTranslations("language");
  const locale = useLocale();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      aria-label={t("switchTo")}
      disabled={pending}
      onClick={() => startTransition(() => setLocale(locale === "th" ? "en" : "th"))}
      className={cn(
        "inline-flex h-11 items-center gap-1.5 rounded-md px-3 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50",
        className,
      )}
    >
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
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </svg>
      {t("label")}
    </button>
  );
}
