"use client";

import { useTranslations } from "next-intl";
import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import {
  WORD_MAX_LENGTH,
  wordKey,
  wordLength,
  wordProblem,
  type AnswerAck,
  type SlideActivityView,
  type WordResult,
} from "@moddeck/shared";
import { RichText } from "@/components/content/RichText";
import { WordCloud } from "@/components/wordcloud/WordCloud";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { useDraft } from "@/lib/drafts";
import { useCanSend } from "@/lib/realtime/live-status";

export type SendWord = (payload: {
  activityRunId: string;
  text: string;
  answerId: string;
}) => Promise<AnswerAck<WordResult>>;

type Problem = "failed" | "closed" | "invalid" | null;

/**
 * The word cloud on a student phone (MD-15 S11, S12): the text field while the activity is live,
 * the words this student sent, then "closed" and the cloud once the host shows results. A word
 * counts only when the server's ack says so (MD-5 rule 6). What is typed stays in the field and in
 * local storage while the connection is down.
 */
export function WordCloudActivity({
  view,
  myWords,
  onSent,
  send,
}: {
  view: SlideActivityView;
  /** The words the server holds for this student, as shown. */
  myWords: string[];
  onSent: (text: string) => void;
  send: SendWord;
}) {
  const t = useTranslations("live.wordCloud");
  const { activity, run } = view;

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-5">
      <RichText source={activity.prompt} className="text-xl leading-snug font-semibold" />
      {run?.state === "live" ? (
        <WordForm
          key={run.activityRunId}
          limit={activity.maxEntries}
          runId={run.activityRunId}
          myWords={myWords}
          onSent={onSent}
          send={send}
        />
      ) : run?.state === "results_shown" ? (
        <Results view={view} myWords={myWords} />
      ) : (
        <div className="flex flex-col gap-3">
          <Banner className="rounded-md">{t("closed")}</Banner>
          {myWords.length === 0 ? (
            <p className="text-muted">{t("noWords")}</p>
          ) : (
            <SentWords words={myWords} limit={activity.maxEntries} />
          )}
        </div>
      )}
    </div>
  );
}

function Results({ view, myWords }: { view: SlideActivityView; myWords: string[] }) {
  const t = useTranslations("live.wordCloud");
  const ts = useTranslations("presenter.stage");
  const cloud = view.cloud ?? { words: [], entries: 0 };
  const mine = useMemo(() => new Set(myWords.map(wordKey)), [myWords]);
  return (
    <>
      <p className="text-sm font-semibold text-muted">{t("entries", { count: cloud.entries })}</p>
      {cloud.words.length === 0 ? (
        <p className="text-muted">{ts("noWords")}</p>
      ) : (
        <WordCloud words={cloud.words} scale="panel" mine={mine} className="min-h-40 py-2" />
      )}
    </>
  );
}

function SentWords({ words, limit }: { words: string[]; limit: number }) {
  const t = useTranslations("live.wordCloud");
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-muted">
        {t("yourWords", { sent: words.length, limit })}
      </p>
      <ul className="flex flex-wrap gap-2">
        {words.map((word) => (
          <li
            key={word}
            className="rounded-lg border border-primary-500 bg-primary-50 px-3 py-1.5 leading-[1.6] font-semibold"
          >
            {word}
          </li>
        ))}
      </ul>
    </div>
  );
}

function WordForm({
  limit,
  runId,
  myWords,
  onSent,
  send,
}: {
  limit: number;
  runId: string;
  myWords: string[];
  onSent: (text: string) => void;
  send: SendWord;
}) {
  const t = useTranslations("live.wordCloud");
  const canSend = useCanSend();
  const inputId = useId();
  const hintId = useId();
  const [text, setText, clearText] = useDraft(`word:${runId}`);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [repeated, setRepeated] = useState(false);
  // The server said the limit is reached, whatever this phone counted.
  const [full, setFull] = useState(false);
  // One id per word. A retry of the same text sends the same id, so it never counts twice.
  const attempt = useRef<{ text: string; answerId: string } | null>(null);

  const atLimit = full || myWords.length >= limit;
  const length = wordLength(text);
  const typed = text.trim().length > 0;
  const tooLong = typed && wordProblem(text) === "TOO_LONG";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!typed || tooLong || atLimit || sending || !canSend) return;
    if (attempt.current?.text !== text) {
      attempt.current = { text, answerId: crypto.randomUUID() };
    }
    setSending(true);
    setProblem(null);
    setRepeated(false);
    try {
      const ack = await send({ activityRunId: runId, text, answerId: attempt.current.answerId });
      if (ack.ok) {
        attempt.current = null;
        clearText();
        if (ack.result) {
          // The same word again: the server kept the first one and used nothing up. A retry after
          // a lost ack is also a duplicate, but its word is new to this list, so it says nothing.
          const key = wordKey(ack.result.text);
          setRepeated(myWords.some((word) => wordKey(word) === key));
          onSent(ack.result.text);
        }
      } else if (ack.error.code === "LIMIT_REACHED") {
        setFull(true);
      } else if (ack.error.code === "ACTIVITY_CLOSED") {
        setProblem("closed");
      } else {
        setProblem(ack.error.code === "INVALID_PAYLOAD" ? "invalid" : "failed");
      }
    } catch {
      setProblem("failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2" noValidate>
        <label htmlFor={inputId} className="text-sm font-semibold">
          {t("label")}
        </label>
        <input
          id={inputId}
          type="text"
          value={text}
          disabled={atLimit}
          enterKeyHint="send"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={t("placeholder")}
          aria-invalid={tooLong}
          aria-describedby={hintId}
          onChange={(event) => {
            setText(event.target.value);
            setProblem(null);
            setRepeated(false);
          }}
          className="h-12 w-full rounded-lg border border-border bg-background px-3 text-lg leading-normal focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:bg-neutral-100 aria-invalid:border-error-600"
        />
        <p
          id={hintId}
          className={cn(
            "flex justify-between gap-3 text-sm tabular-nums",
            tooLong ? "font-semibold text-error-700" : "text-muted",
          )}
        >
          <span>{tooLong ? t("tooLong", { max: WORD_MAX_LENGTH }) : t("hint")}</span>
          <span>{t("counter", { count: length, max: WORD_MAX_LENGTH })}</span>
        </p>
        <Button
          type="submit"
          size="lg"
          fullWidth
          disabled={!typed || tooLong || atLimit || !canSend || sending}
        >
          {sending ? t("sending") : t("send")}
        </Button>
      </form>

      {repeated && (
        <p role="status" className="text-sm text-muted">
          {t("repeated")}
        </p>
      )}
      {problem && (
        <p role="alert" className="text-sm font-semibold text-error-700">
          {t(problem)}
        </p>
      )}
      {atLimit ? (
        <Banner tone="success" className="rounded-md">
          {t("limitReached")}
        </Banner>
      ) : (
        myWords.length > 0 && (
          <p className="text-sm text-muted">{t("remaining", { count: limit - myWords.length })}</p>
        )
      )}
      {myWords.length > 0 && <SentWords words={myWords} limit={limit} />}
    </div>
  );
}
