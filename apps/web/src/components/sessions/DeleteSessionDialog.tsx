"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { SessionSummary } from "@moddeck/shared";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ApiError } from "@/lib/api/client";
import { useSessionDate } from "./SessionMeta";

/** Delete with confirm. A hard delete: the dialog says plainly that nothing comes back. */
export function DeleteSessionDialog({
  session,
  onConfirm,
  onClose,
}: {
  session: SessionSummary;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations("history");
  const tCommon = useTranslations("common");
  const tDecks = useTranslations("decks");
  const date = useSessionDate();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    setError(undefined);
    try {
      await onConfirm();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : null;
      setError(
        code === "SESSION_LIVE" || code === "NOT_FOUND" ? t(`errors.${code}`) : t("errors.generic"),
      );
      setPending(false);
    }
  }

  return (
    <Dialog title={t("deleteDialog.title")} closeLabel={tCommon("close")} onClose={onClose}>
      <p className="text-muted">
        {t("deleteDialog.description", { title: session.deck.title, date: date(session) })}
      </p>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-error-500 bg-error-50 px-4 py-3 text-sm text-error-700"
        >
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2.5">
        <Button variant="secondary" onClick={onClose}>
          {tDecks("form.cancel")}
        </Button>
        <Button variant="danger" disabled={pending} onClick={confirm}>
          {t("deleteDialog.confirm")}
        </Button>
      </div>
    </Dialog>
  );
}
