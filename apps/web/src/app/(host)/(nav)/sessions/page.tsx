import { useTranslations } from "next-intl";
import { HostPage } from "@/components/shell/HostPage";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";

export default function SessionsPage() {
  const t = useTranslations("pages");
  return (
    <HostPage title={t("sessions.title")}>
      <PagePlaceholder page="sessions" titled={false} />
    </HostPage>
  );
}
