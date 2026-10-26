import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { LanguageSwitch } from "./LanguageSwitch";
import { LogoMark } from "./Logo";

/**
 * Compact header for the full-screen host tools (MD-15 H02 editor, H05 presenter, H11 co-host):
 * a leading mark, the deck or session title, then tool-specific extras.
 */
export function SessionHeader({
  title,
  subtitle,
  leading = "logo",
  badge,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  /** "back" makes the logo a link to My decks (editor). "live" shows the red LIVE badge. */
  leading?: "logo" | "back" | "live";
  badge?: ReactNode;
  children?: ReactNode;
}) {
  const t = useTranslations("host");

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2.5 border-b border-neutral-200 bg-background px-4 py-2.5 sm:px-6">
      {leading === "live" && (
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-error-600 px-2.5 text-sm font-bold tracking-wide text-white">
          <span aria-hidden="true" className="size-2 rounded-full bg-white" />
          {t("live")}
        </span>
      )}
      {leading === "back" && (
        <Link
          href="/decks"
          aria-label={t("backToDecks")}
          className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <LogoMark />
        </Link>
      )}
      {leading === "logo" && <LogoMark />}
      <div className="flex min-w-0 flex-[1_1_240px] flex-col">
        <h1 className="truncate text-base font-semibold">{title}</h1>
        {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
      </div>
      {badge}
      {children}
      <LanguageSwitch />
    </header>
  );
}
