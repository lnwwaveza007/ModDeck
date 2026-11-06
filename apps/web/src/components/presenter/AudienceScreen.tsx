"use client";

import { useEffect, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import { useTranslations } from "next-intl";
import type { LiveSessionView, LiveSlide } from "@moddeck/shared";
import { cn } from "@/lib/cn";
import { getSession } from "@/lib/api/sessions";
import { formatDuration, secondsLeft, useServerNow } from "@/lib/live/clock";
import { runLiveCommand } from "@/lib/live/commands";
import { useScreenLayers } from "@/lib/live/screen-channel";
import { SHORTCUT_LIST, useShortcuts } from "@/lib/live/shortcuts";
import { runOf, useLiveSession, type LiveSessionState } from "@/lib/live/use-live-session";
import { Kbd } from "./Kbd";
import { LiveStage } from "./LiveStage";
import { ShortcutHelp } from "./ShortcutHelp";

const NO_VOTES = { votes: {}, answered: 0 };
const COUNT_POLL_MS = 5000;
// A refresh joins the room in a moment. Only a join that takes longer than this is worth showing.
const CONNECT_GRACE_MS = 2000;

const joinAddress = (joinUrl: string) =>
  joinUrl.replace(/^https?:\/\//, "").replace(/\/j\/\d+$/, "");
const spacedPin = (pin: string) => pin.replace(/(\d{3})(\d{3})/, "$1 $2");

/**
 * MD-15 P01–P09 audience screen, for the projector. It follows the room like every other screen.
 * Every size on the stage is a `cqw`, so it is the same picture on any projector resolution.
 * With one display the host runs the lecture from here: the shortcuts work on this page, and O
 * opens the presenter overlay (MD-5 rule 2). In mirror mode the audience sees the overlay too;
 * that limit is accepted for R1.
 */
export function AudienceScreen({ sessionId }: { sessionId: string }) {
  const t = useTranslations("screen");
  const [state, controls] = useLiveSession(sessionId);
  const layers = useScreenLayers(
    sessionId,
    state.slides[state.currentIndex]?.id ?? null,
    state.currentIndex === 0,
    state.view?.showResultsLive,
  );
  const [overlay, setOverlay] = useState(false);
  const [help, setHelp] = useState(false);
  const participants = useParticipantCount(sessionId, state.view?.participantCount ?? 0);
  const now = useServerNow(state.clockOffset);
  const [connectGrace, setConnectGrace] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setConnectGrace(false), CONNECT_GRACE_MS);
    return () => clearTimeout(timer);
  }, []);

  useShortcuts((command) => {
    if (command === "overlay") return setOverlay((open) => !open);
    if (command === "help") return setHelp((open) => !open);
    if (command === "fullscreen") return void toggleFullscreen();
    return runLiveCommand(command, state, controls, layers);
  });

  const { view, slides, currentIndex, runs, tallies } = state;
  if (state.loadError || !view) {
    return (
      <div className="grid flex-1 place-items-center bg-neutral-900 text-neutral-100">
        <p role="status">{state.loadError ? t(`loadError.${state.loadError}`) : t("loading")}</p>
      </div>
    );
  }

  const [screen] = layers;
  const current = slides[currentIndex];
  const activity = current?.activity;
  const run = activity ? runOf(runs, activity.id) : undefined;
  const connectionLost =
    state.connection === "reconnecting" ||
    state.connection === "offline" ||
    (state.connection === "connecting" && !connectGrace);

  return (
    <div
      className={cn(
        "relative grid flex-1 place-items-center",
        state.ended ? "bg-primary-50" : screen.blank ? "bg-black" : "bg-neutral-900",
      )}
    >
      {state.ended ? (
        <EndedCard title={view.title} participants={participants} />
      ) : screen.blank ? (
        <p className="sr-only">{t("blanked")}</p>
      ) : (
        <div className="@container relative aspect-video w-full max-w-[calc(100vh*16/9)]">
          {current && (
            <LiveStage
              slide={current}
              run={run}
              tally={run ? (tallies[run.activityRunId] ?? NO_VOTES) : undefined}
              liveChart={screen.liveChart}
              now={now}
              className="rounded-none border-0"
            />
          )}
          {screen.join ? (
            <JoinPanel view={view} participants={participants} />
          ) : (
            screen.joinBar && (
              <div className="absolute top-[1.6cqw] right-[1.9cqw] flex h-[3.1cqw] items-center gap-[0.8cqw] rounded-[0.8cqw] bg-neutral-900 px-[1.1cqw] text-[1.25cqw] text-white">
                <span>{joinAddress(view.joinUrl)}</span>
                <b className="font-mono text-[1.56cqw] tracking-[0.06em] text-primary-400">
                  {spacedPin(view.pin)}
                </b>
              </div>
            )
          )}
          {connectionLost && (
            <p
              role="status"
              className="absolute bottom-[1.9cqw] left-[1.9cqw] flex h-[3.4cqw] items-center gap-[0.8cqw] rounded-full border border-warning-500 bg-warning-100 px-[1.25cqw] text-[1.4cqw] font-semibold text-warning-800"
            >
              <span
                aria-hidden="true"
                className="size-[1.5cqw] rounded-full border-[0.25cqw] border-warning-100 border-t-warning-800 motion-safe:animate-spin"
              />
              {t("reconnecting")}
            </p>
          )}
        </div>
      )}

      {overlay && !state.ended && (
        <PresenterOverlay
          state={state}
          now={now}
          participants={participants}
          next={slides[currentIndex + 1]}
        />
      )}
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
    </div>
  );
}

/** Big PIN and QR for joining (MD-15 P01): on the first slide until moved on, toggled with J. */
function JoinPanel({ view, participants }: { view: LiveSessionView; participants: number }) {
  const t = useTranslations("screen");
  const [qr, setQr] = useState("");
  useEffect(() => {
    let active = true;
    // Larger than it is drawn at 1080p, so the projector never blurs the modules.
    QRCode.toDataURL(view.joinUrl, { width: 1024, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => active && setQr(url))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [view.joinUrl]);

  return (
    <div className="absolute inset-0 flex bg-background text-foreground">
      <div className="flex min-w-0 flex-1 flex-col gap-[3.1cqw] px-[5.6cqw] py-[5cqw]">
        <h1 className="line-clamp-2 text-[3.75cqw] leading-[1.3] font-bold">{view.title}</h1>
        <ol className="flex flex-col gap-[1.6cqw] text-[1.9cqw] leading-[1.4]">
          <JoinStep number={1}>
            {t.rich("joinOpen", {
              url: joinAddress(view.joinUrl),
              b: (chunks) => <b>{chunks}</b>,
            })}
          </JoinStep>
          <JoinStep number={2}>{t("joinPin")}</JoinStep>
        </ol>
        <p className="font-mono text-[10cqw] leading-[1.1] font-semibold tracking-[0.06em] text-primary-700">
          {spacedPin(view.pin)}
        </p>
        <p className="mt-auto flex items-center gap-[0.9cqw] text-[1.9cqw] text-neutral-700">
          <span aria-hidden="true" className="size-[1.1cqw] rounded-full bg-success-600" />
          <span>
            {t.rich("joined", {
              count: participants,
              b: (chunks) => <b className="text-[2.5cqw] text-foreground tabular-nums">{chunks}</b>,
            })}
          </span>
        </p>
      </div>
      <div className="flex w-[36cqw] flex-col items-center justify-center gap-[1.6cqw] bg-primary-50">
        {qr && (
          // A data URL from the qrcode library: next/image has nothing to optimise here.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qr}
            alt={t("qrAlt", { pin: view.pin })}
            className="aspect-square w-[25cqw] rounded-[1.6cqw] bg-white p-[1cqw] [image-rendering:pixelated]"
          />
        )}
        <p className="text-[1.7cqw] leading-[1.4] text-neutral-700">{t("joinScan")}</p>
      </div>
    </div>
  );
}

function JoinStep({ number, children }: { number: number; children: ReactNode }) {
  return (
    <li className="flex items-center gap-[1.25cqw]">
      <span
        aria-hidden="true"
        className="grid size-[3.4cqw] shrink-0 place-items-center rounded-full bg-neutral-900 text-[1.56cqw] font-bold text-white"
      >
        {number}
      </span>
      <span>{children}</span>
    </li>
  );
}

/** MD-15 P07: the last thing the room sees. */
function EndedCard({ title, participants }: { title: string; participants: number }) {
  const t = useTranslations("screen");
  return (
    <div className="@container grid aspect-video w-full max-w-[calc(100vh*16/9)] place-items-center">
      <div className="flex w-[64cqw] flex-col items-center gap-[1.9cqw] rounded-[2.2cqw] border border-primary-200 bg-background p-[5cqw] text-center text-foreground">
        <span className="grid size-[7.5cqw] place-items-center rounded-full bg-success-50">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-[4cqw] text-success-700"
          >
            <path d="M5 12l5 5L20 7" />
          </svg>
        </span>
        <h1 className="text-[4.4cqw] leading-[1.3] font-bold">{t("ended")}</h1>
        <p className="text-[2cqw] leading-[1.45] text-neutral-700">{title}</p>
        <p className="text-[1.7cqw] leading-[1.45] text-neutral-600">
          {t("endedJoined", { count: participants })}
        </p>
      </div>
    </div>
  );
}

/** MD-15 H10: next slide, counts and the keys, over the slide on a single display. */
function PresenterOverlay({
  state,
  now,
  participants,
  next,
}: {
  state: LiveSessionState;
  now: number;
  participants: number;
  next?: LiveSlide;
}) {
  const t = useTranslations("screen.overlay");
  const ts = useTranslations("presenter.shortcuts");
  const ta = useTranslations("presenter.activity");
  const { view, slides, currentIndex, runs } = state;
  const activity = slides[currentIndex]?.activity;
  const run = activity ? runOf(runs, activity.id) : null;
  const elapsed = view ? Math.max(0, (now - Date.parse(view.startedAt)) / 1000) : 0;

  return (
    <aside
      aria-label={t("label")}
      className="absolute right-4 bottom-4 flex w-80 flex-col gap-3 rounded-xl bg-neutral-900/95 p-4 text-sm text-neutral-100 shadow-lg ring-1 ring-neutral-700"
    >
      <div className="flex items-center justify-between">
        <b>
          {t("live")} · <span className="tabular-nums">{formatDuration(elapsed)}</span>
        </b>
        <span className="text-neutral-300">
          {t("slide", { index: currentIndex + 1, total: slides.length })} · <Kbd dark>O</Kbd>{" "}
          {t("hide")}
        </span>
      </div>
      <p>{t("participants", { count: participants })}</p>
      {activity && run && (
        <p>
          {ta(`state.${run.state}`)}
          {run.state === "live" && run.endsAt && (
            <span className="ml-2 font-mono tabular-nums">
              {formatDuration(secondsLeft(run.endsAt, now))}
            </span>
          )}
        </p>
      )}
      <div className="flex flex-col gap-1">
        <span className="text-neutral-300">
          {next ? t("next", { index: currentIndex + 2 }) : t("lastSlide")}
        </span>
        {next && <LiveStage slide={next} now={now} thumbnail className="w-40" />}
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs text-neutral-300">
        {SHORTCUT_LIST.map(({ command, keys }) => (
          <div key={command} className="contents">
            <dt>{ts(command)}</dt>
            <dd className="flex gap-1 justify-self-end">
              {keys.map((key) => (
                <Kbd key={key} dark>
                  {key}
                </Kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

function useParticipantCount(sessionId: string, initial: number): number {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    const poll = setInterval(() => {
      getSession(sessionId).then(
        (session) => setCount(session.participantCount),
        () => undefined,
      );
    }, COUNT_POLL_MS);
    return () => clearInterval(poll);
  }, [sessionId]);
  return count ?? initial;
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen?.();
  else void document.documentElement.requestFullscreen?.().catch(() => undefined);
}
