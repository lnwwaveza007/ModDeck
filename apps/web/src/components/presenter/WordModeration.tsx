"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { WordCount } from "@moddeck/shared";
import { Button } from "@/components/ui/Button";

/**
 * The host's list of words (profanity, off-topic): hide one and it leaves the projector and the
 * phones at once. A hidden word stays here, so a click shows it again. Q25: no automatic filter in
 * R1, the host decides.
 */
export function WordModeration({
  words,
  hiddenWords,
  onSetHidden,
}: {
  /** The visible words, most sent first. */
  words: WordCount[];
  hiddenWords: WordCount[];
  onSetHidden: (key: string, hidden: boolean) => Promise<void>;
}) {
  const t = useTranslations("presenter.activity.words");
  // One request at a time per word, so a double click cannot send it twice.
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

  const toggle = async (key: string, hidden: boolean) => {
    if (busy.has(key)) return;
    setBusy((current) => new Set(current).add(key));
    try {
      await onSetHidden(key, hidden);
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const row = (word: WordCount, hidden: boolean) => (
    <li
      key={word.key}
      className="flex items-center gap-3 rounded-md border border-neutral-200 py-1 pr-1 pl-3"
    >
      <span className="min-w-0 flex-1 truncate leading-[1.6] font-semibold">{word.text}</span>
      <span className="text-sm text-muted tabular-nums">× {word.count}</span>
      <Button
        variant="ghost"
        disabled={busy.has(word.key)}
        aria-label={t(hidden ? "showLabel" : "hideLabel", { word: word.text })}
        onClick={() => void toggle(word.key, !hidden)}
      >
        {t(hidden ? "show" : "hide")}
      </Button>
    </li>
  );

  if (words.length === 0 && hiddenWords.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {words.length > 0 && (
        <section aria-label={t("title")} className="flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold">{t("title")}</h3>
          <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-1">
            {words.map((word) => row(word, false))}
          </ul>
        </section>
      )}
      {hiddenWords.length > 0 && (
        <section aria-label={t("hiddenTitle")} className="flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold">
            {t("hiddenTitle")} ({hiddenWords.length})
          </h3>
          <ul className="flex max-h-40 flex-col gap-1.5 overflow-y-auto pr-1">
            {hiddenWords.map((word) => row(word, true))}
          </ul>
        </section>
      )}
    </div>
  );
}
