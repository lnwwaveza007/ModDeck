import { useTranslations } from "next-intl";
import { LoadingState } from "@/components/states/LoadingState";

/** Body of every loading.tsx. */
export function RouteLoading() {
  const t = useTranslations("states");
  return <LoadingState label={t("loading")} />;
}
