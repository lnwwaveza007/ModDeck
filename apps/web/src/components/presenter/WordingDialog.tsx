"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  ACTIVITY_PROMPT_MAX,
  POLL_OPTION_LABEL_MAX,
  type ActivityWordingBody,
  type LiveActivity,
} from "@moddeck/shared";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ApiError } from "@/lib/api/client";
import { optionLetter } from "./LiveStage";

/**
 * Fix a typo during the lecture. Only the wording changes: options keep their place, so the
 * answers already given still point at what the students chose (MD-5 rule 7).
 */
export function WordingDialog({
  activity,
  onSave,
  onClose,
}: {
  activity: LiveActivity;
  onSave: (body: ActivityWordingBody) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations("presenter.wording");
  const tc = useTranslations("common");
  const [prompt, setPrompt] = useState(activity.prompt);
  const [labels, setLabels] = useState(activity.options.map((option) => option.label));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const promptId = useId();

  const empty = !prompt.trim() || labels.some((label) => !label.trim());

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (empty || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        prompt,
        ...(activity.type === "poll" && {
          options: activity.options.map((option, i) => ({ id: option.id, label: labels[i] })),
        }),
      });
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "ACTIVITY_LOCKED" ? t("locked") : t("failed"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog title={t("title")} closeLabel={tc("close")} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t("hint")}</p>
        <div className="flex flex-col gap-1">
          <label htmlFor={promptId} className="text-sm font-semibold">
            {t("prompt")}
          </label>
          <textarea
            id={promptId}
            autoFocus
            rows={3}
            maxLength={ACTIVITY_PROMPT_MAX}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2"
          />
        </div>
        {activity.type === "poll" && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold">{t("options")}</legend>
            {activity.options.map((option, i) => (
              <label key={option.id} className="flex items-center gap-2">
                <span className="w-6 text-center font-bold">{optionLetter(i)}</span>
                <span className="sr-only">{t("option", { letter: optionLetter(i) })}</span>
                <input
                  value={labels[i]}
                  maxLength={POLL_OPTION_LABEL_MAX}
                  onChange={(event) =>
                    setLabels((current) =>
                      current.map((label, j) => (j === i ? event.target.value : label)),
                    )
                  }
                  className="h-11 flex-1 rounded-md border border-border bg-background px-3"
                />
              </label>
            ))}
          </fieldset>
        )}
        {error && (
          <p role="alert" className="text-sm text-error-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={empty || saving}>
            {t("save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
