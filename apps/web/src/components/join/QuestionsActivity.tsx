"use client";

import { useCallback, useEffect, useState } from "react";
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
}: {
  sessionId: string;
  nickname: string;
  anonymousAllowed?: boolean;
}) {
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
        .catch(() => setError("Could not load questions.")),
    [sessionId, sort],
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
    } catch {
      setError("Please wait before asking another question, or check your connection.");
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
    } catch {
      setError("Could not update your vote.");
    }
  };

  if (composing) {
    return (
      <section className="flex min-h-0 flex-1 flex-col bg-background">
        <header className="flex h-14 items-center gap-3 border-b border-neutral-200 px-4">
          <button
            type="button"
            aria-label="Back to questions"
            onClick={() => {
              setComposing(false);
              setPreview(false);
              setError("");
            }}
            className="grid size-10 place-items-center rounded-lg text-xl text-neutral-700 hover:bg-neutral-100"
          >
            ×
          </button>
          <h2 className="font-semibold">Ask a question</h2>
          <button
            type="button"
            disabled={busy || !text.trim()}
            onClick={() => void submit()}
            className="ml-auto rounded-lg bg-orange-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send"}
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {anonymousAllowed && (
            <div className="rounded-xl border border-neutral-200 bg-surface px-3 py-2">
              <Toggle
                label="Anonymous Mode"
                description={
                  anonymous
                    ? "Your name will not be shown"
                    : `Your name will be shown as ${nickname}`
                }
                checked={anonymous}
                onCheckedChange={setAnonymous}
              />
            </div>
          )}

          <div>
            <label htmlFor="question-text" className="mb-2 block text-sm font-semibold">
              Question
            </label>
            {preview ? (
              <div className="min-h-36 rounded-xl border border-orange-600 bg-white p-3 text-sm">
                {text.trim() ? (
                  <RichText source={text} />
                ) : (
                  <span className="text-muted">Nothing to preview yet.</span>
                )}
              </div>
            ) : (
              <textarea
                id="question-text"
                aria-label="Question"
                maxLength={280}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="What do you want to ask?"
                className="min-h-36 w-full resize-y rounded-xl border border-orange-600 bg-white p-3 text-sm focus:outline-2 focus:outline-orange-200"
              />
            )}
            <div className="mt-1 flex items-center justify-between text-xs text-muted">
              <span>Use `code`, fenced code blocks and $math$.</span>
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
              Write
            </button>
            <button
              type="button"
              onClick={() => setPreview(true)}
              aria-pressed={preview}
              className={`flex-1 rounded-md py-2 text-sm ${preview ? "bg-white font-semibold shadow-sm" : "text-muted"}`}
            >
              Preview
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
            {busy ? "Sending…" : "Post question"}
          </button>
        </footer>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex rounded-xl bg-slate-200 p-1" aria-label="Sort questions">
        {(["top", "newest"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={sort === value}
            onClick={() => setSort(value)}
            className={`flex-1 rounded-lg p-2 text-sm ${sort === value ? "bg-white font-semibold shadow-sm" : "text-muted"}`}
          >
            {value === "top" ? "Top questions" : "Newest"}
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
              <RichText source={question.text} className="text-sm" />
              <p className="mt-2 text-xs text-slate-500">
                {question.anonymous ? "Anonymous" : question.author} ·{" "}
                {new Date(question.createdAt).toLocaleTimeString()}
              </p>
            </div>
            <button
              type="button"
              aria-label={`${question.ownQuestion ? "Your question" : question.voted ? "Remove upvote" : "Upvote"}: ${question.votes}`}
              aria-pressed={question.voted ?? false}
              title={question.ownQuestion ? "You cannot upvote your own question" : undefined}
              disabled={question.ownQuestion}
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
          <p className="py-8 text-center text-sm text-slate-500">
            No questions yet. Ask the first one!
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => {
          setAnonymous(anonymousAllowed);
          setComposing(true);
          setError("");
        }}
        className="mt-auto w-full shrink-0 rounded-xl border border-slate-200 bg-primary-600 p-3 font-semibold text-white"
      >
        Post a question
      </button>
    </section>
  );
}
