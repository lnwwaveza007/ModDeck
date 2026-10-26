import { useTranslations } from "next-intl";
import { LiveShell } from "@/components/shell/LiveShell";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";

// MD-15 S06 frame. The session name and connection state come from the socket later.
export default function LivePage() {
  const t = useTranslations("pages");
  return (
    <main className="flex h-dvh flex-col">
      <LiveShell
        title={t("live.title")}
        activity={<PagePlaceholder page="live" titled={false} />}
        qa={<PagePlaceholder page="live" titled={false} />}
      />
    </main>
  );
}
