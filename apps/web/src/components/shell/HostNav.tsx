"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";

const links = [
  { href: "/decks", key: "decks" },
  { href: "/sessions", key: "sessions" },
] as const;

/** MD-15 H01 tabs: the current section gets an orange underline. */
export function HostNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();

  return (
    <nav aria-label={t("main")} className="flex flex-1 gap-6">
      {links.map(({ href, key }) => {
        const current = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "inline-flex h-16 items-center border-b-3 px-1 focus-visible:outline-2 focus-visible:outline-ring",
              current
                ? "border-primary-500 font-semibold text-foreground"
                : "border-transparent font-medium text-neutral-700 hover:text-foreground",
            )}
          >
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
