"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/states/ErrorState";

/** Body of every error.tsx. Next.js 16 passes `retry` (it re-renders the failed segment). */
export function RouteError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useTranslations("states");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      title={t("errorTitle")}
      description={t("errorDescription")}
      actions={
        <Button size="lg" fullWidth onClick={() => retry()}>
          {t("retry")}
        </Button>
      }
    />
  );
}
