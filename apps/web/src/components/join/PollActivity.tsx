"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import type { AnswerAck, SlideActivityView, VoteResult } from "@moddeck/shared";
import { RichText } from "@/components/content/RichText";
import { optionColor, optionLetter, PollChart } from "@/components/poll/PollChart";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { canChangeAnswer } from "@/lib/live/student-activity";
import { useCanSend } from "@/lib/realtime/live-status";

export type SendVote = (payload: {
  activityRunId: string;
  optionIds: string[];
  answerId: string;
}) => Promise<AnswerAck<VoteResult>>;

const EMPTY_TALLY = { votes: {}, answered: 0 };

type Problem = "failed" | "closed" | null;

/**
 * The poll on a student phone (MD-15 S07 to S10): the form while voting is open, "Answer sent" once
 * the server has confirmed it, then "Voting closed" and the results. The phone never says a vote
 * counted before the ack comes back (MD-5 rule 6).
 */
export function PollActivity({
  view,
  myOptionId,
  onAnswered,
  send,
}: {
  view: SlideActivityView;
  /** The answer the server holds for this student. */
  myOptionId: string | null;
  onAnswered: (optionId: string) => void;
  send: SendVote;
}) {
  const t = useTranslations("live.poll");
  const { activity, run } = view;

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-5">
      <RichText source={activity.prompt} className="text-xl leading-snug font-semibold" />
      {run?.state === "live" ? (
        <VoteForm
          key={run.activityRunId}
          view={view}
          runId={run.activityRunId}
          myOptionId={myOptionId}
          onAnswered={onAnswered}
          send={send}
        />
      ) : run?.state === "results_shown" ? (
        <>
          <p className="text-sm font-semibold text-muted">
            {t("answered", { count: (view.results ?? EMPTY_TALLY).answered })}
          </p>
          <PollChart
            options={activity.options}
            tally={view.results ?? EMPTY_TALLY}
            scale="panel"
            mine={myOptionId}
          />
        </>
      ) : (
        <Closed view={view} myOptionId={myOptionId} />
      )}
    </div>
  );
}

function Closed({ view, myOptionId }: { view: SlideActivityView; myOptionId: string | null }) {
  const t = useTranslations("live.poll");
  const index = view.activity.options.findIndex((option) => option.id === myOptionId);
  return (
    <div className="flex flex-col gap-3">
      <Banner className="rounded-md">{t("closed")}</Banner>
      {index === -1 ? (
        <p className="text-muted">{t("noAnswer")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-muted">{t("yourAnswer")}</p>
          <OptionFace
            index={index}
            label={view.activity.options[index].label}
            className="border-primary-500 bg-primary-50"
          />
        </div>
      )}
    </div>
  );
}

function OptionFace({
  index,
  label,
  className,
}: {
  index: number;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex min-h-14 w-full items-center gap-3 rounded-lg border border-border p-3 text-left",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-md font-bold text-white",
          optionColor(index),
        )}
      >
        {optionLetter(index)}
      </span>
      <RichText source={label} className="min-w-0 flex-1 text-base" />
    </span>
  );
}

function VoteForm({
  view,
  runId,
  myOptionId,
  onAnswered,
  send,
}: {
  view: SlideActivityView;
  runId: string;
  myOptionId: string | null;
  onAnswered: (optionId: string) => void;
  send: SendVote;
}) {
  const t = useTranslations("live.poll");
  const canSend = useCanSend();
  const [picked, setPicked] = useState<string | null>(myOptionId);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  // Whether the last send found the answer locked: the server kept the first one.
  const [kept, setKept] = useState(false);
  // One id per answer. A retry of the same choice sends the same id, so it never counts twice.
  const attempt = useRef<{ optionId: string; answerId: string } | null>(null);

  const changeable = canChangeAnswer(view);
  const locked = myOptionId !== null && !changeable;
  const unsent = picked !== null && picked !== myOptionId;

  const submit = async () => {
    if (!picked || sending || !canSend) return;
    if (attempt.current?.optionId !== picked) {
      attempt.current = { optionId: picked, answerId: crypto.randomUUID() };
    }
    setSending(true);
    setProblem(null);
    try {
      const ack = await send({
        activityRunId: runId,
        optionIds: [picked],
        answerId: attempt.current.answerId,
      });
      if (ack.ok) {
        const counted = ack.result?.optionIds[0] ?? picked;
        attempt.current = null;
        setKept(counted !== picked);
        setPicked(counted);
        onAnswered(counted);
      } else {
        setProblem(ack.error.code === "ACTIVITY_CLOSED" ? "closed" : "failed");
      }
    } catch {
      setProblem("failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label={t("options")} className="flex flex-col gap-2">
        {view.activity.options.map((option, index) => {
          const selected = picked === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={locked || sending}
              onClick={() => {
                setPicked(option.id);
                setProblem(null);
                setKept(false);
              }}
              className="rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <OptionFace
                index={index}
                label={option.label}
                className={selected ? "border-2 border-primary-600 bg-primary-50" : undefined}
              />
            </button>
          );
        })}
      </div>

      {myOptionId !== null && !unsent && !sending && (
        <div className="flex flex-col gap-1">
          <Banner tone="success" className="rounded-md">
            {t("sent")}
          </Banner>
          <p className="text-sm text-muted">
            {kept ? t("kept") : changeable ? t("changeHint") : t("lockedHint")}
          </p>
        </div>
      )}
      {problem && (
        <p role="alert" className="text-sm font-semibold text-error-700">
          {t(problem === "closed" ? "closed" : "failed")}
        </p>
      )}
      {!locked && (myOptionId === null || unsent) && (
        <Button
          size="lg"
          fullWidth
          disabled={!picked || !canSend || sending}
          onClick={() => void submit()}
        >
          {sending ? t("sending") : myOptionId === null ? t("submit") : t("change")}
        </Button>
      )}
    </div>
  );
}
