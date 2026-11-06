"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import {
  ACTIVITY_PROMPT_MAX,
  POLL_OPTION_LABEL_MAX,
  POLL_OPTIONS_MAX,
  POLL_OPTIONS_MIN,
} from "@moddeck/shared";
import { Button } from "@/components/ui/Button";
import { optionLetter } from "@/components/poll/PollChart";
import { isPollComplete, newPollRow, type PollDraft } from "@/lib/editor/poll-draft";
import { IconButton, TrashIcon } from "./ActionIcons";

const fieldClass =
  "w-full rounded-md border border-border bg-background px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

/**
 * MD-15 H03 poll editor: the question and 2 to 8 options, one answer per student. Code and math are
 * allowed in both, and the stage next to this panel shows them rendered. Autosaves when complete.
 */
export function PollEditor({
  initial,
  onChange,
}: {
  initial: PollDraft;
  onChange: (draft: PollDraft) => void;
}) {
  const t = useTranslations("editor.poll");
  const [draft, setDraft] = useState(initial);
  const promptId = useId();

  const update = (next: PollDraft) => {
    setDraft(next);
    onChange(next);
  };
  const setLabel = (key: string, label: string) =>
    update({
      ...draft,
      rows: draft.rows.map((row) => (row.key === key ? { ...row, label } : row)),
    });

  return (
    <section aria-label={t("title")} className="flex flex-col gap-3">
      <h2 className="text-base font-bold">{t("title")}</h2>
      <div className="flex flex-col gap-1">
        <label htmlFor={promptId} className="text-sm font-semibold">
          {t("question")}
        </label>
        <textarea
          id={promptId}
          rows={2}
          maxLength={ACTIVITY_PROMPT_MAX}
          value={draft.prompt}
          placeholder={t("questionPlaceholder")}
          onChange={(event) => update({ ...draft, prompt: event.target.value })}
          className={`${fieldClass} py-2`}
        />
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-semibold">{t("options")}</legend>
        {draft.rows.map((row, index) => (
          <div key={row.key} className="flex items-center gap-2">
            <span aria-hidden="true" className="w-5 shrink-0 text-center font-bold">
              {optionLetter(index)}
            </span>
            <input
              aria-label={t("option", { letter: optionLetter(index) })}
              value={row.label}
              maxLength={POLL_OPTION_LABEL_MAX}
              onChange={(event) => setLabel(row.key, event.target.value)}
              className={`${fieldClass} h-9 min-w-0`}
            />
            <IconButton
              compact
              danger
              label={t("remove", { letter: optionLetter(index) })}
              disabled={draft.rows.length <= POLL_OPTIONS_MIN}
              onClick={() =>
                update({ ...draft, rows: draft.rows.filter((other) => other.key !== row.key) })
              }
            >
              <TrashIcon />
            </IconButton>
          </div>
        ))}
        <Button
          variant="secondary"
          disabled={draft.rows.length >= POLL_OPTIONS_MAX}
          onClick={() => update({ ...draft, rows: [...draft.rows, newPollRow()] })}
        >
          {t("add")}
        </Button>
      </fieldset>

      <p className="text-sm text-muted">
        {t("limit", { min: POLL_OPTIONS_MIN, max: POLL_OPTIONS_MAX })} {t("help")}
      </p>
      {!isPollComplete(draft) && (
        <p role="status" className="text-sm font-semibold text-warning-800">
          {t("incomplete", { min: POLL_OPTIONS_MIN })}
        </p>
      )}
    </section>
  );
}
