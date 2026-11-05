"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useTranslations } from "next-intl";
import type { LiveSessionView, LiveSlide } from "@moddeck/shared";
import { getSession } from "@/lib/api/sessions";
import { formatDuration, secondsLeft, useServerNow } from "@/lib/live/clock";
import { runLiveCommand } from "@/lib/live/commands";
import { useScreenLayers } from "@/lib/live/screen-channel";
import { SHORTCUT_LIST, useShortcuts } from "@/lib/live/shortcuts";
import { runOf, useLiveSession, type LiveSessionState } from "@/lib/live/use-live-session";
import { Kbd } from "./Kbd";
import { LiveStage } from "./LiveStage";
import { ShortcutHelp } from "./ShortcutHelp";

const COUNT_POLL_MS = 5000;

/**
 * MD-15 P01–P07 audience screen, for the projector. It follows the room like every other screen.
 * With one display the host runs the lecture from here: the shortcuts work on this page, and O
 * opens the presenter overlay (MD-5 rule 2). In mirror mode the audience sees the overlay too;
 * that limit is accepted for R1.
 */
export function AudienceScreen({ sessionId }: { sessionId: string }) {
  const t = useTranslations("screen");
  const [state, controls] = useLiveSession(sessionId);
  const layers = useScreenLayers(sessionId);
  const [overlay, setOverlay] = useState(false);
  const [help, setHelp] = useState(false);
  const participants = useParticipantCount(sessionId, state.view?.participantCount ?? 0);
  const now = useServerNow(state.clockOffset);

  useShortcuts((command) => {
    if (command === "overlay") return setOverlay((open) => !open);
    if (command === "help") return setHelp((open) => !open);
    if (command === "fullscreen") return void toggleFullscreen();
    return runLiveCommand(command, state, controls, layers);
  });

  const { view, slides, currentIndex, runs } = state;
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
  const pin = view.pin.replace(/(\d{3})(\d{3})/, "$1 $2");

  return (
    <div className="relative grid flex-1 place-items-center bg-neutral-900">
      {state.ended ? (
        <p className="text-3xl font-bold text-neutral-50">{t("ended")}</p>
      ) : screen.blank ? (
        <p className="sr-only">{t("blanked")}</p>
      ) : (
        <div className="relative w-full max-w-[calc(100vh*16/9)]">
          {current && (
            <LiveStage
              slide={current}
              run={activity ? runOf(runs, activity.id) : undefined}
              now={now}
              className="rounded-none border-0"
            />
          )}
          {screen.join ? (
            <JoinPanel view={view} />
          ) : (
            <div className="absolute top-[2.5%] right-[2%] flex items-center gap-3 rounded-lg bg-neutral-900 px-3 py-1.5 text-sm text-white">
              <span>{view.joinUrl.replace(/^https?:\/\//, "").replace(/\/j\/\d+$/, "")}</span>
              <b className="font-mono text-lg tracking-wider text-primary-400">{pin}</b>
            </div>
          )}
        </div>
      )}

      {state.connection !== "online" && !state.ended && (
        <p
          role="status"
          className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-warning-100 px-4 py-1 text-sm font-semibold text-warning-800"
        >
          {t("reconnecting")}
        </p>
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

/** Big PIN and QR for joining (MD-15 P01), toggled with J from either window. */
function JoinPanel({ view }: { view: LiveSessionView }) {
  const t = useTranslations("screen");
  const [qr, setQr] = useState("");
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(view.joinUrl, { width: 480, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => active && setQr(url))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [view.joinUrl]);

  return (
    <div className="@container absolute inset-0 grid grid-cols-[1fr_auto] items-center gap-[4cqw] bg-background p-[6cqw]">
      <div className="flex flex-col gap-[1.5cqw]">
        <p className="text-[2.6cqw]">
          {t("joinAt", { url: view.joinUrl.replace(/^https?:\/\//, "").replace(/\/j\/\d+$/, "") })}
        </p>
        <p className="text-[2cqw] text-muted">{t("enterPin")}</p>
        <p className="font-mono text-[9cqw] leading-none font-extrabold tracking-[0.12em] text-warning-600">
          {view.pin.replace(/(\d{3})(\d{3})/, "$1 $2")}
        </p>
      </div>
      {qr && (
        // A data URL from the qrcode library: next/image has nothing to optimise here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt={t("qrAlt", { pin: view.pin })} className="aspect-square w-[28cqw]" />
      )}
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
