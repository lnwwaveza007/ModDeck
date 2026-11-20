"use client";

import { useCallback, useEffect, useState } from "react";
import { RichText } from "@/components/content/RichText";
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
  const [anonymous, setAnonymous] = useState(true);
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
      await refresh();
    } catch {
      setError("Please wait before asking another question, or check your connection.");
    } finally {
      setBusy(false);
    }
  };
  const vote = async (q: LiveQuestion) => {
    try {
      const result = await toggleQuestionVote(sessionId, q.id);
      setQuestions((items) =>
        items.map((item) =>
          item.id === q.id ? { ...item, votes: result.votes, voted: result.voted } : item,
        ),
      );
    } catch {
      setError("Could not update your vote.");
    }
  };
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex rounded-xl bg-slate-200 p-1" aria-label="Sort questions">
        {(["top", "newest"] as const).map((value) => (
          <button
            key={value}
            onClick={() => setSort(value)}
            className={`flex-1 rounded-lg p-2 text-sm ${sort === value ? "bg-white font-semibold" : ""}`}
          >
            {value === "top" ? "Top" : "Newest"}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto" aria-live="polite">
        {questions.map((q) => (
          <article
            key={q.id}
            className="flex gap-2 rounded-xl border border-slate-200 bg-white p-3"
          >
            <div className="min-w-0 flex-1">
              <RichText source={q.text} className="text-sm" />
              <p className="mt-2 text-xs text-slate-500">
                {q.author ?? "Anonymous"} · {new Date(q.createdAt).toLocaleTimeString()}
              </p>
            </div>
            <button
              aria-label={`${q.voted ? "Remove upvote" : "Upvote"}: ${q.votes}`}
              onClick={() => void vote(q)}
              className={`flex h-14 min-w-11 flex-col items-center justify-center rounded-lg border ${q.voted ? "border-orange-600 text-orange-700" : "border-slate-300"}`}
            >
              <span aria-hidden="true">↑</span>
              <span className="text-xs">{q.votes}</span>
            </button>
          </article>
        ))}
        {questions.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-500">
            No questions yet. Ask the first one!
          </p>
        )}
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        {anonymousAllowed && (
          <label className="mb-2 flex items-center justify-between text-sm">
            <span>Ask anonymously</span>
            <input
              type="checkbox"
              checked={anonymous}
              onChange={(e) => setAnonymous(e.target.checked)}
            />
          </label>
        )}
        <textarea
          aria-label="Question"
          maxLength={280}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What do you want to ask? Use `code` and $math$."
          className="min-h-24 w-full resize-y rounded-lg border border-slate-300 p-3 text-sm focus:border-orange-600 focus:outline-none"
        />
        <div className="flex items-center justify-between pt-2 text-xs text-slate-500">
          <span>{anonymous ? "Your name will not be shown" : `Asking as ${nickname}`}</span>
          <span>{text.length}/280</span>
        </div>
        <p className="pt-1 text-xs text-slate-500">
          Supports `code`, fenced code blocks, $math$ and $$display math$$.
        </p>
        {error && (
          <p role="alert" className="py-1 text-sm text-red-700">
            {error}
          </p>
        )}
        <button
          disabled={busy || !text.trim()}
          onClick={() => void submit()}
          className="mt-2 w-full rounded-full bg-orange-700 p-3 font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Sending…" : "Ask question"}
        </button>
      </div>
    </section>
  );
}
