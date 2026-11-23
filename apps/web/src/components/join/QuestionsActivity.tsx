"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError } from "@/lib/api/client";
import { RichText } from "@/components/content/RichText";
import { Toggle } from "@/components/ui/Toggle";
import {
  askQuestion,
  getQuestions,
  toggleQuestionVote,
  type LiveQuestion,
} from "@/lib/api/questions";

export function QuestionsActivity({
  sessionId,
  nickname,
  anonymousAllowed = true,
  open = true,
}: {
  sessionId: string;
  nickname: string;
  anonymousAllowed?: boolean;
  /** Closed by the host: the list stays readable, asking and voting stop. */
  open?: boolean;
}) {
  const t = useTranslations("live.qaPanel");
  const [questions, setQuestions] = useState<LiveQuestion[]>([]);
  const [sort, setSort] = useState<"top" | "newest">("top");
  const [text, setText] = useState("");
  const [anonymous, setAnonymous] = useState(anonymousAllowed);
  const [composing, setComposing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(
    () =>
      getQuestions(sessionId, sort)
        .then((data) => setQuestions(data.questions))
        .catch(() => setError(t("loadError"))),
    [sessionId, sort, t],
  );
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    const changed = () => void refresh();
    window.addEventListener("moddeck-questions-changed", changed);
    return () => {
      clearInterval(timer);
      window.removeEventListener("moddeck-questions-changed", changed);
    };
  }, [refresh]);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await askQuestion(sessionId, text, anonymous);
      setText("");
      setPreview(false);
      setComposing(false);
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === "QA_CLOSED"
          ? t("closedError")
          : t("askError"),
      );
    } finally {
      setBusy(false);
    }
  };

  const vote = async (question: LiveQuestion) => {
    try {
      const result = await toggleQuestionVote(sessionId, question.id);
      setQuestions((items) =>
        items.map((item) =>
          item.id === question.id ? { ...item, votes: result.votes, voted: result.voted } : item,
        ),
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === "QA_CLOSED"
          ? t("closedError")
          : t("voteError"),
      );
    }
  };

  if (composing && open) {
    return (
      <section className="flex min-h-0 flex-1 flex-col bg-background">
        <header className="flex h-14 items-center gap-3 border-b border-neutral-200 px-4">
          <button
            type="button"
            aria-label={t("back")}
            onClick={() => {
              setComposing(false);
              setPreview(false);
              setError("");
            }}
            className="grid size-10 place-items-center rounded-lg text-xl text-neutral-700 hover:bg-neutral-100"
          >
            ×
          </button>
          <h2 className="font-semibold">{t("askTitle")}</h2>
          <button
            type="button"
            disabled={busy || !text.trim()}
            onClick={() => void submit()}
            className="ml-auto rounded-lg bg-orange-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? t("sending") : t("send")}
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {anonymousAllowed && (
            <div className="rounded-xl border border-neutral-200 bg-surface px-3 py-2">
              <Toggle
                label={t("anonymousMode")}
                description={
                  anonymous ? t("anonymousDescription") : t("namedDescription", { nickname })
                }
                checked={anonymous}
                onCheckedChange={setAnonymous}
              />
            </div>
          )}

          <div>
            <label htmlFor="question-text" className="mb-2 block text-sm font-semibold">
              {t("questionLabel")}
            </label>
            {preview ? (
              <div className="min-h-36 rounded-xl border border-orange-600 bg-white p-3 text-sm">
                {text.trim() ? (
                  <RichText source={text} />
                ) : (
                  <span className="text-muted">{t("emptyPreview")}</span>
                )}
              </div>
            ) : (
              <textarea
                id="question-text"
                aria-label={t("questionLabel")}
                maxLength={280}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={t("placeholder")}
                className="min-h-36 w-full resize-y rounded-xl border border-orange-600 bg-white p-3 text-sm focus:outline-2 focus:outline-orange-200"
              />
            )}
            <div className="mt-1 flex items-center justify-between text-xs text-muted">
              <span>{t("formatHint")}</span>
              <span>{text.length}/280</span>
            </div>
          </div>

          <div className="flex rounded-lg bg-surface p-1">
            <button
              type="button"
              onClick={() => setPreview(false)}
              aria-pressed={!preview}
              className={`flex-1 rounded-md py-2 text-sm ${!preview ? "bg-white font-semibold shadow-sm" : "text-muted"}`}
            >
              {t("write")}
            </button>
            <button
              type="button"
              onClick={() => setPreview(true)}
              aria-pressed={preview}
              className={`flex-1 rounded-md py-2 text-sm ${preview ? "bg-white font-semibold shadow-sm" : "text-muted"}`}
            >
              {t("preview")}
            </button>
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
        <footer className="shrink-0 border-t border-neutral-200 bg-background p-3">
          <button
            type="button"
            disabled={busy || !text.trim()}
            onClick={() => void submit()}
            className="w-full rounded-xl border border-slate-200 bg-primary-600 p-3 font-semibold text-white shadow-md disabled:opacity-30"
          >
            {busy ? t("sending") : t("postQuestion")}
          </button>
        </footer>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex rounded-xl bg-slate-200 p-1" aria-label={t("sortLabel")}>
        {(["top", "newest"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={sort === value}
            onClick={() => setSort(value)}
            className={`flex-1 rounded-lg p-2 text-sm ${sort === value ? "bg-white font-semibold shadow-sm" : "text-muted"}`}
          >
            {value === "top" ? t("topQuestions") : t("newest")}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto" aria-live="polite">
        {questions.map((question) => (
          <article
            key={question.id}
            className="flex gap-2 rounded-xl border border-neutral-200 bg-white p-3"
          >
            <div className="min-w-0 flex-1">
              {(question.status === "highlighted" || question.status === "answered") && (
                <span
                  className={`mb-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${question.status === "highlighted" ? "bg-primary-50 text-primary-700" : "bg-success-50 text-success-700"}`}
                >
                  {t(question.status === "highlighted" ? "onScreen" : "answered")}
                </span>
              )}
              <RichText source={question.text} className="text-sm" />
              <p className="mt-2 text-xs text-slate-500">
                {question.anonymous ? t("anonymous") : question.author} ·{" "}
                {new Date(question.createdAt).toLocaleTimeString()}
              </p>
            </div>
            <button
              type="button"
              aria-label={`${question.ownQuestion ? t("yourQuestion") : question.voted ? t("removeUpvote") : t("upvote")}: ${question.votes}`}
              aria-pressed={question.voted ?? false}
              title={question.ownQuestion ? t("ownVoteTitle") : undefined}
              disabled={question.ownQuestion || !open}
              onClick={() => void vote(question)}
              className={`group flex h-14 min-w-12 flex-col items-center justify-center gap-0.5 rounded-xl border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:opacity-50 ${question.voted ? "border-primary-400 bg-primary-400 text-white" : "border-neutral-200 text-neutral-500 hover:border-orange-400 hover:bg-orange-50 hover:text-orange-700"}`}
            >
              <svg
                aria-hidden="true"
                width="19"
                height="19"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-transform ${question.voted ? "-translate-y-0.5" : "group-hover:-translate-y-0.5"}`}
              >
                <path d="M12 19V5" />
                <path d="m5 12 7-7 7 7" />
              </svg>
              <span className="text-xs font-semibold tabular-nums">{question.votes}</span>
            </button>
          </article>
        ))}
        {questions.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-500">{t("noQuestions")}</p>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {open ? (
        <button
          type="button"
          onClick={() => {
            setAnonymous(anonymousAllowed);
            setComposing(true);
            setError("");
          }}
          className="mt-auto w-full shrink-0 rounded-xl border border-slate-200 bg-primary-600 p-3 font-semibold text-white"
        >
          {t("postQuestion")}
        </button>
      ) : (
        <p
          role="status"
          className="mt-auto rounded-xl bg-neutral-100 p-3 text-center text-sm text-neutral-700"
        >
          {t("closed")}
        </p>
      )}
    </section>
  );
}
