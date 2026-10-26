import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import { HostPage } from "@/components/shell/HostPage";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";
import { SessionHeader } from "@/components/shell/SessionHeader";

// MD-15 H11 frame: header with the co-host role badge, then the Q&A column.
export default function CohostQaPage() {
  const t = useTranslations();
  return (
    <>
      <SessionHeader
        title={t("pages.live.title")}
        badge={<Badge tone="primary">{t("host.cohostBadge")}</Badge>}
      />
      <main className="flex flex-1 flex-col">
        <HostPage title={t("pages.cohostQa.title")} titleAs="h2">
          <PagePlaceholder page="cohostQa" titled={false} />
        </HostPage>
      </main>
    </>
  );
}
