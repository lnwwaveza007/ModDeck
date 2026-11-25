"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { LiveQuestion, QuestionAction } from "@moddeck/shared";
import { RichText } from "@/components/content/RichText";
import { Toggle } from "@/components/ui/Toggle";
import { cn } from "@/lib/cn";
import { groupQuestions } from "@/lib/live/questions";
import { Kbd } from "./Kbd";

/** The start of a question, for the buttons' accessible names. */
const excerpt = (text: string) => (text.length > 60 ? `${text.slice(0, 57)}…` : text);

const actionClass =
  "inline-flex h-8 items-center rounded-md px-2.5 text-xs font-semibold text-neutral-700 transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50";

/**
 * Q&A moderation in presenter control (F6, MD-15 H05): the questions come in live, most votes
 * first. The host marks one answered, hides one from the students, or pins one large on the
 * projector, and opens or closes Q&A. A question that came in since the panel opened carries a
 * "New" badge until the host marks it seen or acts on it.
 */
export function QaPanel({
  questions,
  open,
  ended,
  canToggle = true,
  onSetOpen,
  onModerate,
}: {
  questions: LiveQuestion[];
  open: boolean;
  ended: boolean;
  /** Opening and closing Q&A is part of presenter control: a co-host without it only moderates. */
  canToggle?: boolean;
  onSetOpen: (open: boolean) => void;
  onModerate: (questionId: string, action: QuestionAction) => Promise<void>;
}) {
  const t = useTranslations("presenter.qa");
  // What was there when the panel opened counts as seen: only arrivals get the badge.
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set(questions.map((q) => q.id)));
  // One request at a time per question, so a double click cannot send it twice.
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

  const { pinned, open: openQuestions, answered, hidden } = groupQuestions(questions);
  const unseen = questions.filter((q) => q.status !== "hidden" && !seen.has(q.id));

  const markSeen = (ids: string[]) =>
    setSeen((current) =>
      ids.every((id) => current.has(id)) ? current : new Set([...current, ...ids]),
    );

  const act = async (question: LiveQuestion, action: QuestionAction) => {
    if (busy.has(question.id)) return;
    markSeen([question.id]);
    setBusy((current) => new Set(current).add(question.id));
    try {
      await onModerate(question.id, action);
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(question.id);
        return next;
      });
    }
  };

  const button = (question: LiveQuestion, action: QuestionAction) => {
    // "Restore" reads as what it undoes: unpin, show again, or reopen an answered question.
    const label =
      action !== "restore"
        ? action
        : question.status === "highlighted"
          ? "unpin"
          : question.status === "hidden"
            ? "show"
            : "reopen";
    return (
      <button
        key={action}
        type="button"
        className={actionClass}
        disabled={ended || busy.has(question.id)}
        aria-label={t(`${label}Label`, { text: excerpt(question.text) })}
        onClick={() => void act(question, action)}
      >
        {t(label)}
      </button>
    );
  };

  const row = (question: LiveQuestion, actions: QuestionAction[]) => (
    <li
      key={question.id}
      className={cn(
        "flex flex-col gap-1.5 rounded-md border border-neutral-200 bg-background p-3",
        question.status === "hidden" && "bg-neutral-50 text-muted",
      )}
    >
      <RichText source={question.text} className="text-sm wrap-break-word" />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <span className="font-semibold text-foreground tabular-nums">
          ▲ {t("votes", { count: question.votes })}
        </span>
        <span>·</span>
        {/* Anonymous questions come without a name, so none can show here. */}
        <span>{question.anonymous ? t("anonymous") : question.author}</span>
        {!seen.has(question.id) && question.status !== "hidden" && (
          <span className="rounded-full bg-primary-50 px-2 py-0.5 font-semibold text-primary-700">
            {t("newBadge")}
          </span>
        )}
      </div>
      <div className="-ml-2 flex flex-wrap gap-1">
        {actions.map((action) => button(question, action))}
      </div>
    </li>
  );

  return (
    <section
      aria-label={t("title")}
      className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-background p-5"
    >
      <div className="flex items-center gap-2">
        <h2 className="font-bold">
          {t("title")} <Kbd>Q</Kbd>
        </h2>
        {unseen.length > 0 && (
          <button
            type="button"
            title={t("markSeen")}
            aria-label={`${t("newCount", { count: unseen.length })}. ${t("markSeen")}`}
            onClick={() => markSeen(unseen.map((q) => q.id))}
            className="ml-auto rounded-full bg-primary-600 px-2.5 py-0.5 text-xs font-bold text-white tabular-nums hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {t("newCount", { count: unseen.length })}
          </button>
        )}
      </div>
      <Toggle
        label={t("open")}
        description={open ? t("openOn") : t("openOff")}
        checked={open}
        disabled={ended || !canToggle}
        onCheckedChange={onSetOpen}
      />

      {pinned && (
        <section aria-label={t("pinned")} className="flex flex-col gap-1.5">
          <h3 className="text-xs font-bold tracking-wide text-primary-700 uppercase">
            {t("pinned")}
          </h3>
          <ul className="rounded-md ring-2 ring-primary-500">
            {row(pinned, ["restore", "answer", "hide"])}
          </ul>
        </section>
      )}

      {questions.length === 0 ? (
        <p className="text-sm text-muted">{t("empty")}</p>
      ) : (
        openQuestions.length > 0 && (
          <section aria-label={t("openTitle")}>
            <ul className="flex max-h-112 flex-col gap-2 overflow-y-auto pr-1">
              {openQuestions.map((q) => row(q, ["pin", "answer", "hide"]))}
            </ul>
          </section>
        )
      )}

      {answered.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-sm font-semibold">
            {t("answeredTitle", { count: answered.length })}
          </summary>
          <ul className="mt-2 flex max-h-60 flex-col gap-2 overflow-y-auto pr-1">
            {answered.map((q) => row(q, ["restore", "pin", "hide"]))}
          </ul>
        </details>
      )}

      {hidden.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-semibold">
            {t("hiddenTitle", { count: hidden.length })}
          </summary>
          <ul className="mt-2 flex max-h-60 flex-col gap-2 overflow-y-auto pr-1">
            {hidden.map((q) => row(q, ["restore"]))}
          </ul>
        </details>
      )}
    </section>
  );
}
