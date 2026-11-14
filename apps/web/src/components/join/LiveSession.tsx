"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import {
  wordKey,
  type ParticipantMe,
  type SlideActivityView,
  type VoteResult,
  type WordResult,
} from "@moddeck/shared";
import { LiveShell } from "@/components/shell/LiveShell";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";
import { Banner } from "@/components/ui/Banner";
import { buttonClass } from "@/components/ui/Button";
import { ApiError } from "@/lib/api/client";
import { getParticipantMe } from "@/lib/api/participants";
import { LiveConnection, type ConnectionStatus } from "@/lib/realtime/live-connection";
import { applyRoomEvent } from "@/lib/live/student-activity";
import { LiveStatusProvider } from "@/lib/realtime/live-status";
import { PollActivity, type SendVote } from "./PollActivity";
import { WordCloudActivity, type SendWord } from "./WordCloudActivity";

type Stop = "notJoined" | "removed" | "ended" | "full" | "network";

function stopFor(error: unknown): Stop {
  if (!(error instanceof ApiError)) return "network";
  if (error.code === "PARTICIPANT_REMOVED") return "removed";
  if (error.code === "SESSION_ENDED") return "ended";
  if (error.code === "SESSION_FULL") return "full";
  if (error.status === 401) return "notJoined";
  return "network";
}

/**
 * Student live screen (MD-15 S06). A late joiner starts from the slide the class is
 * on now: /participants/me gives it, then the socket keeps it current. A poll or word cloud on
 * the current slide shows here once the host has started it.
 */
export function LiveSession({ sessionId }: { sessionId: string }) {
  const t = useTranslations("live");
  const [me, setMe] = useState<ParticipantMe | null>(null);
  const [stop, setStop] = useState<Stop | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [slideIndex, setSlideIndex] = useState<number | null>(null);
  const [activity, setActivity] = useState<SlideActivityView | null>(null);
  // Run id → the answer the server confirmed. The phone keeps it when the room moves on and back.
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // Run id → the words the server confirmed for this student, in the order they were sent.
  const [words, setWords] = useState<Record<string, string[]>>({});
  const live = useRef<LiveConnection | undefined>(undefined);

  useEffect(() => {
    let active = true;
    let connection: LiveConnection | undefined;
    // Re-reads where the class is, for a snapshot after a (re)join.
    const apply = (value: ParticipantMe) => {
      setSlideIndex(value.currentSlide?.index ?? null);
      setActivity(value.currentActivity);
      const runId = value.currentActivity?.run?.activityRunId;
      const answer = value.currentActivity?.myOptionId;
      if (runId && answer) setAnswers((current) => ({ ...current, [runId]: answer }));
      const sent = value.currentActivity?.myWords;
      // The server knows every word it counted: it replaces what this phone remembered.
      if (runId && sent) setWords((current) => ({ ...current, [runId]: sent }));
    };
    const refresh = () =>
      getParticipantMe().then(
        (value) => active && apply(value),
        () => undefined,
      );

    getParticipantMe().then(
      (value) => {
        if (!active) return;
        // The cookie belongs to another session: this browser has not joined this one.
        if (value.sessionId !== sessionId) return setStop("notJoined");
        setMe(value);
        apply(value);
        connection = new LiveConnection({
          sessionId,
          onStatus: (next) => {
            setStatus(next);
            // `ended` also follows a refusal (removed, full): the reason already set stays.
            if (next === "ended") setStop((current) => current ?? "ended");
          },
          onSnapshot: () => void refresh(),
          onEvent: (event) => {
            if (event.type === "slide_changed") setSlideIndex(event.data.index);
            setActivity((current) => applyRoomEvent(current, event));
            if (event.type === "session_ended") setStop("ended");
          },
          onError: (error) => {
            if (error.code === "PARTICIPANT_REMOVED") setStop("removed");
            if (error.code === "SESSION_ENDED") setStop("ended");
            if (error.code === "SESSION_FULL") setStop("full");
          },
        });
        live.current = connection;
        connection.connect();
      },
      (error: unknown) => {
        if (active) setStop(stopFor(error));
      },
    );
    return () => {
      active = false;
      live.current = undefined;
      connection?.close();
    };
  }, [sessionId]);

  if (stop) return <Stopped reason={stop} />;
  if (!me) {
    return (
      <p role="status" className="m-auto text-muted">
        {t("connecting")}
      </p>
    );
  }

  const sendVote: SendVote = async (payload) => {
    if (!live.current) throw new Error("Not connected");
    return live.current.send<VoteResult>("vote", payload);
  };
  const sendWord: SendWord = async (payload) => {
    if (!live.current) throw new Error("Not connected");
    return live.current.send<WordResult>("word", payload);
  };
  const run = activity?.run;
  const started = run && run.state !== "draft";
  const showPoll = activity?.activity.type === "poll" && started;
  const showCloud = activity?.activity.type === "word_cloud" && started;

  const statusText =
    status === "online"
      ? t("connectedAs", { name: me.nickname })
      : status === "connecting"
        ? t("connecting")
        : t(status === "offline" ? "offline" : "reconnecting");

  // Answers are paused until the server can confirm them (MD-5 rule 6). The controls read
  // the same status through useCanSend() and disable themselves.
  const banner =
    status === "reconnecting" || status === "offline" ? (
      <Banner tone="warning" aria-live="polite">
        {t(status === "offline" ? "banner.offline" : "banner.reconnecting")}
      </Banner>
    ) : null;

  return (
    <LiveStatusProvider status={status}>
      <LiveShell
        title={me.title}
        status={statusText}
        banner={banner}
        activity={
          showPoll ? (
            <PollActivity
              view={activity}
              myOptionId={answers[run.activityRunId] ?? null}
              onAnswered={(optionId) =>
                setAnswers((current) => ({ ...current, [run.activityRunId]: optionId }))
              }
              send={sendVote}
            />
          ) : showCloud ? (
            <WordCloudActivity
              view={activity}
              myWords={words[run.activityRunId] ?? []}
              onSent={(text) =>
                setWords((current) => {
                  const sent = current[run.activityRunId] ?? [];
                  // A word the server already had (a repeat) is not listed twice.
                  return sent.some((word) => wordKey(word) === wordKey(text))
                    ? current
                    : { ...current, [run.activityRunId]: [...sent, text] };
                })
              }
              send={sendWord}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-xl font-semibold">{t("lookAtScreen")}</p>
              <p className="text-muted">
                {slideIndex === null
                  ? t("startingSoon")
                  : t("slideOf", { index: slideIndex + 1, total: me.slideCount })}
              </p>
            </div>
          )
        }
        qa={<PagePlaceholder page="live" titled={false} />}
      />
    </LiveStatusProvider>
  );
}

function Stopped({ reason }: { reason: Stop }) {
  const t = useTranslations("live");
  return (
    <section className="flex flex-1 flex-col justify-center gap-6 px-5 pb-10">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-bold">{t(`stopped.${reason}.title`)}</h1>
        <p className="text-neutral-700">{t(`stopped.${reason}.body`)}</p>
      </div>
      <Link href="/" className={buttonClass({ size: "lg", fullWidth: true })}>
        {t("enterPin")}
      </Link>
    </section>
  );
}
