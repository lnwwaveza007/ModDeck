import { useTranslations } from "next-intl";
import { HostPage } from "@/components/shell/HostPage";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";

export default function SessionResultsPage() {
  const t = useTranslations("pages");
  return (
    <HostPage title={t("sessionResults.title")}>
      <PagePlaceholder page="sessionResults" titled={false} />
    </HostPage>
  );
}
