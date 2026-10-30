"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { DECK_TITLE_MAX, deckTitleSchema } from "@moddeck/shared";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { ApiError } from "@/lib/api/client";

function useErrorText() {
  const t = useTranslations("decks.errors");
  return (error: unknown) =>
    error instanceof ApiError && (error.code === "DECK_LIVE" || error.code === "NOT_FOUND")
      ? t(error.code)
      : t("generic");
}

/** New deck and Rename (MD-15 H01): one name field, checked with the api's own rule. */
export function DeckTitleDialog({
  mode,
  initialTitle = "",
  onSubmit,
  onClose,
}: {
  mode: "create" | "rename";
  initialTitle?: string;
  onSubmit: (title: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations("decks");
  const tCommon = useTranslations("common");
  const errorText = useErrorText();
  const [title, setTitle] = useState(initialTitle);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const heading = mode === "create" ? t("create.title") : t("renameDialog.title");
  const submitLabel = mode === "create" ? t("create.submit") : t("renameDialog.submit");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = deckTitleSchema.safeParse(title);
    if (!parsed.success) {
      const tooLong = parsed.error.issues.some((issue) => issue.code === "too_big");
      setError(
        tooLong ? t("errors.titleTooLong", { max: DECK_TITLE_MAX }) : t("errors.titleRequired"),
      );
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      await onSubmit(parsed.data);
    } catch (err) {
      setError(errorText(err));
      setPending(false);
    }
  }

  return (
    <Dialog title={heading} closeLabel={tCommon("close")} onClose={onClose}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-5">
        <Input
          label={t("form.name")}
          value={title}
          maxLength={DECK_TITLE_MAX}
          error={error}
          onChange={(event) => setTitle(event.target.value)}
        />
        <div className="flex justify-end gap-2.5">
          <Button variant="secondary" onClick={onClose}>
            {t("form.cancel")}
          </Button>
          <Button type="submit" disabled={pending}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Delete with confirm. The deck is hidden, its session results stay (soft delete). */
export function DeleteDeckDialog({
  title,
  onConfirm,
  onClose,
}: {
  title: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations("decks");
  const tCommon = useTranslations("common");
  const errorText = useErrorText();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    setError(undefined);
    try {
      await onConfirm();
    } catch (err) {
      setError(errorText(err));
      setPending(false);
    }
  }

  return (
    <Dialog
      title={t("deleteDialog.title", { title })}
      closeLabel={tCommon("close")}
      onClose={onClose}
    >
      <p className="text-muted">{t("deleteDialog.description")}</p>
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
          {t("form.cancel")}
        </Button>
        <Button variant="danger" disabled={pending} onClick={confirm}>
          {t("deleteDialog.confirm")}
        </Button>
      </div>
    </Dialog>
  );
}
