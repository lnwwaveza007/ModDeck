import Link from "next/link";
import { useTranslations } from "next-intl";
import { buttonClass } from "@/components/ui/Button";
import { EmptyState } from "@/components/states/EmptyState";

export default function NotFound() {
  const t = useTranslations();
  return (
    <main className="flex min-h-screen flex-col">
      <EmptyState
        titleAs="h1"
        title={t("states.notFoundTitle")}
        description={t("states.notFoundDescription")}
        action={
          <Link href="/" className={buttonClass({ variant: "secondary" })}>
            {t("common.backHome")}
          </Link>
        }
      />
    </main>
  );
}
