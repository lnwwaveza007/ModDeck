"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import {
  ACTIVITY_PROMPT_MAX,
  WORD_ENTRIES_MAX,
  WORD_ENTRIES_MIN,
  WORD_MAX_LENGTH,
} from "@moddeck/shared";
import { cn } from "@/lib/cn";
import { isWordCloudComplete, type WordCloudDraft } from "@/lib/editor/word-cloud-draft";

const fieldClass =
  "w-full rounded-md border border-border bg-background px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

const CHOICES = Array.from(
  { length: WORD_ENTRIES_MAX - WORD_ENTRIES_MIN + 1 },
  (_, i) => WORD_ENTRIES_MIN + i,
);

/**
 * MD-15 H04 word cloud editor: the prompt and how many words each student may send (1 to 3). A
 * word is at most 25 visible characters, the same for every cloud: it is told here, not set.
 * Autosaves when complete.
 */
export function WordCloudEditor({
  initial,
  onChange,
}: {
  initial: WordCloudDraft;
  onChange: (draft: WordCloudDraft) => void;
}) {
  const t = useTranslations("editor.wordCloud");
  const [draft, setDraft] = useState(initial);
  const promptId = useId();

  const update = (next: WordCloudDraft) => {
    setDraft(next);
    onChange(next);
  };

  return (
    <section aria-label={t("title")} className="flex flex-col gap-3">
      <h2 className="text-base font-bold">{t("title")}</h2>
      <div className="flex flex-col gap-1">
        <label htmlFor={promptId} className="text-sm font-semibold">
          {t("prompt")}
        </label>
        <textarea
          id={promptId}
          rows={2}
          maxLength={ACTIVITY_PROMPT_MAX}
          value={draft.prompt}
          placeholder={t("promptPlaceholder")}
          onChange={(event) => update({ ...draft, prompt: event.target.value })}
          className={`${fieldClass} py-2`}
        />
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-semibold">{t("entries")}</legend>
        <div className="flex gap-2">
          {CHOICES.map((count) => (
            <label
              key={count}
              className={cn(
                "grid h-11 flex-1 cursor-pointer place-items-center rounded-md border border-border text-base font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-ring",
                draft.maxEntries === count
                  ? "border-2 border-primary-600 bg-primary-50"
                  : "bg-background hover:bg-surface",
              )}
            >
              <input
                type="radio"
                name={`${promptId}-entries`}
                value={count}
                checked={draft.maxEntries === count}
                onChange={() => update({ ...draft, maxEntries: count })}
                className="sr-only"
              />
              {count}
            </label>
          ))}
        </div>
      </fieldset>

      <p className="text-sm text-muted">{t("limit", { max: WORD_MAX_LENGTH })}</p>
      {!isWordCloudComplete(draft) && (
        <p role="status" className="text-sm font-semibold text-warning-800">
          {t("incomplete")}
        </p>
      )}
    </section>
  );
}
