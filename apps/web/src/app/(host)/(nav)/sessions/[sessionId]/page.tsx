import Link from "next/link";
import { useTranslations } from "next-intl";
import { HostPage } from "@/components/shell/HostPage";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";
import { buttonClass } from "@/components/ui/Button";

export default function SessionResultsPage() {
  const t = useTranslations();
  return (
    <HostPage
      title={t("pages.sessionResults.title")}
      // An ended session lands here, so the way back to the decks sits next to the title.
      actions={
        <Link href="/decks" className={buttonClass({ variant: "secondary" })}>
          {t("host.backToDecks")}
        </Link>
      }
    >
      <PagePlaceholder page="sessionResults" titled={false} />
    </HostPage>
  );
}
