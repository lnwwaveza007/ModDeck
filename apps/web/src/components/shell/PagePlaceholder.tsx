import { useTranslations } from "next-intl";
import type { Messages } from "next-intl";
import { EmptyState } from "@/components/states/EmptyState";

export type PageKey = keyof Messages["pages"];

/**
 * Stand-in for screen content that is not built yet. Inside a frame that already shows the
 * page title (host pages), pass `titled={false}` so the heading is not repeated.
 */
export function PagePlaceholder({ page, titled = true }: { page: PageKey; titled?: boolean }) {
  const t = useTranslations();
  return titled ? (
    <EmptyState
      titleAs="h1"
      title={t(`pages.${page}.title`)}
      description={t("common.comingSoon")}
    />
  ) : (
    <EmptyState title={t("common.comingSoon")} />
  );
}
