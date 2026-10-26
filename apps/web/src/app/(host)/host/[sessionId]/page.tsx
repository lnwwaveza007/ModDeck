import { useTranslations } from "next-intl";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";
import { SessionHeader } from "@/components/shell/SessionHeader";

// MD-15 H05 frame: LIVE header on a grey work area.
export default function PresenterPage() {
  const t = useTranslations("pages");
  return (
    <div className="flex flex-1 flex-col bg-neutral-100">
      <SessionHeader leading="live" title={t("presenter.title")} />
      <main className="flex flex-1 flex-col p-4">
        <PagePlaceholder page="presenter" titled={false} />
      </main>
    </div>
  );
}
