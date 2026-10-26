import { useTranslations } from "next-intl";
import { HostPage } from "@/components/shell/HostPage";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";

export default function DecksPage() {
  const t = useTranslations("pages");
  return (
    <HostPage title={t("decks.title")}>
      <PagePlaceholder page="decks" titled={false} />
    </HostPage>
  );
}
