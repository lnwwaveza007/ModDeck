"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { formatDuration, useServerNow } from "@/lib/live/clock";
import { runLiveCommand } from "@/lib/live/commands";
import { useScreenLayers } from "@/lib/live/screen-channel";
import { useShortcuts } from "@/lib/live/shortcuts";
import { runOf, useLiveSession } from "@/lib/live/use-live-session";
import { Button, buttonClass } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { ActivityControls } from "./ActivityControls";
import { EndSessionButton, useSessionEnd } from "./EndSession";
import { Kbd } from "./Kbd";
import { LiveStage } from "./LiveStage";
import { ShortcutHelp } from "./ShortcutHelp";
import { SlideStrip } from "./SlideStrip";
import { WordingDialog } from "./WordingDialog";

const NO_VOTES = { votes: {}, answered: 0 };

const ERROR_KEYS = [
  "SESSION_ENDED",
  "INVALID_TRANSITION",
  "ACTIVITY_LOCKED",
  "NETWORK_ERROR",
] as const;
type ErrorKey = (typeof ERROR_KEYS)[number] | "generic";

function errorKey(error: unknown): ErrorKey {
  const code = error instanceof ApiError ? error.code : "";
  return (ERROR_KEYS as readonly string[]).includes(code) ? (code as ErrorKey) : "generic";
}

/**
 * MD-15 H05 presenter control: the host runs the lecture from this one screen (MD-5 rule 2).
 * Current and next slide, the slide strip, activity controls, the Q&A slot, the participant
 * count and the clock. The audience screen (/screen/:id) follows the room, in another window on
 * the projector, or full screen on the only display with the O overlay.
 */
export function PresenterControl({ sessionId }: { sessionId: string }) {
  const t = useTranslations("presenter");
  const toast = useToast();
  const onError = (error: unknown) => toast(t(`errors.${errorKey(error)}`), { tone: "error" });
  const [state, controls] = useLiveSession(sessionId, { onError });
  const end = useSessionEnd(sessionId);
  const layers = useScreenLayers(
    sessionId,
    state.slides[state.currentIndex]?.id ?? null,
    state.currentIndex === 0,
    state.view?.showResultsLive,
  );
  const [help, setHelp] = useState(false);
  const [editing, setEditing] = useState(false);
  const durationRef = useRef<number | undefined | null>(undefined);
  const now = useServerNow(state.clockOffset);

  useShortcuts((command) => {
    if (command === "help") return setHelp((open) => !open);
    const duration = durationRef.current;
    if (command === "toggleActivity" && duration === null) return; // invalid custom timer
    return runLiveCommand(command, state, controls, layers, duration ?? undefined);
  });

  const { view, slides, currentIndex, runs, tallies } = state;
  if (state.loadError || !view) {
    return (
      <main className="grid min-h-[70vh] place-items-center">
        <p role="status">{state.loadError ? t(`loadError.${state.loadError}`) : t("loading")}</p>
      </main>
    );
  }

  const current = slides[currentIndex];
  const next = slides[currentIndex + 1];
  const activity = current?.activity ?? null;
  const run = activity ? runOf(runs, activity.id) : null;
  const tally = run ? (tallies[run.activityRunId] ?? NO_VOTES) : undefined;
  const pin = view.pin.replace(/(\d{3})(\d{3})/, "$1 $2");
  const elapsed = Math.max(0, (now - Date.parse(view.startedAt)) / 1000);
  const participants = end.session?.participantCount ?? view.participantCount;
  const [screen, setScreen] = layers;

  return (
    <div className="flex min-h-screen flex-col bg-neutral-100 text-foreground">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-neutral-200 bg-background px-6 py-3">
        <span className="rounded-full bg-error-600 px-3 py-0.5 text-sm font-bold text-white">
          {t("live")}
        </span>
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{view.title}</h1>
        <span className="rounded-md bg-neutral-100 px-2.5 py-1 font-mono text-sm font-semibold text-primary-700">
          PIN {pin}
        </span>
        <span className="rounded-md bg-neutral-100 px-2.5 py-1 text-sm font-semibold tabular-nums">
          <span className="sr-only">{t("elapsed")} </span>
          {formatDuration(elapsed)}
        </span>
        <span className="rounded-md bg-neutral-100 px-2.5 py-1 text-sm font-semibold">
          {t("participants", { count: participants })}
        </span>
        <span
          role="status"
          className={cn(
            "text-sm",
            state.connection === "online" ? "text-success-700" : "font-semibold text-warning-800",
          )}
        >
          {t(`connection.${state.connection}`)}
        </span>
        <a
          href={`/screen/${sessionId}`}
          target={`moddeck-screen-${sessionId}`}
          className={buttonClass({ variant: "secondary" })}
        >
          {t("openScreen")}
        </a>
        <Button variant="ghost" onClick={() => setHelp(true)} aria-label={t("shortcuts.title")}>
          ? <Kbd>?</Kbd>
        </Button>
        <EndSessionButton ending={end.ending} onEnd={() => void end.end().catch(onError)} />
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 p-6">
        {state.ended && (
          <p role="status" className="rounded-xl bg-neutral-200 px-5 py-3 font-semibold">
            {t("ended")}
          </p>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <main className="flex min-w-0 flex-col gap-5">
            <div className="grid gap-5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <section aria-label={t("current")} className="flex flex-col gap-2">
                <p className="text-sm">
                  <b>{t("nowShowing", { index: currentIndex + 1, total: slides.length })}</b>
                  {screen.blank && <span className="ml-2 text-warning-800">· {t("blanked")}</span>}
                  {screen.join && <span className="ml-2 text-warning-800">· {t("joinShown")}</span>}
                </p>
                {current && (
                  <LiveStage
                    slide={current}
                    run={run ?? undefined}
                    tally={tally}
                    liveChart={screen.liveChart}
                    now={now}
                    className="shadow-sm"
                  />
                )}
              </section>
              <section aria-label={t("next")} className="flex flex-col gap-2">
                <p className="text-sm">
                  <b>{t("next")}</b>
                  {next && ` · ${t("slide", { index: currentIndex + 2 })}`}
                </p>
                {next ? (
                  <LiveStage slide={next} now={now} thumbnail className="opacity-90" />
                ) : (
                  <div className="grid aspect-video place-items-center rounded-lg border border-dashed border-neutral-300 text-sm text-muted">
                    {t("lastSlide")}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="lg"
                    aria-label={t("previous")}
                    disabled={currentIndex === 0}
                    onClick={controls.previous}
                  >
                    ← <Kbd>←</Kbd>
                  </Button>
                  <Button
                    variant="secondary"
                    size="lg"
                    className="flex-1"
                    disabled={!next && !screen.join}
                    onClick={() => runLiveCommand("next", state, controls, layers)}
                  >
                    {screen.join ? t("showSlide") : t("nextButton")} → <Kbd>Space</Kbd>
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    aria-pressed={screen.blank}
                    onClick={() => setScreen({ blank: !screen.blank })}
                  >
                    {t("blank")} <Kbd>B</Kbd>
                  </Button>
                  <Button
                    variant="ghost"
                    aria-pressed={screen.join}
                    onClick={() => setScreen({ join: !screen.join })}
                  >
                    {t("joinScreen")} <Kbd>J</Kbd>
                  </Button>
                  <Button
                    variant="ghost"
                    aria-pressed={screen.joinBar}
                    onClick={() => setScreen({ joinBar: !screen.joinBar })}
                  >
                    {t("joinBar")} <Kbd>H</Kbd>
                  </Button>
                </div>
              </section>
            </div>

            {activity && run ? (
              <ActivityControls
                key={activity.id}
                activity={activity}
                run={run}
                tally={tally ?? NO_VOTES}
                liveChart={screen.liveChart}
                onLiveChart={() => setScreen({ liveChart: !screen.liveChart })}
                now={now}
                durationRef={durationRef}
                onAct={(action, duration) => controls.act(activity.id, action, duration)}
                onEditWording={() => setEditing(true)}
              />
            ) : (
              <p className="rounded-xl border border-dashed border-neutral-300 bg-background px-5 py-4 text-sm text-muted">
                {t("noActivity")}
              </p>
            )}
          </main>

          <aside className="flex flex-col gap-5">
            <section
              aria-label={t("qa.title")}
              className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-background p-5"
            >
              <h2 className="font-bold">
                {t("qa.title")} <Kbd>Q</Kbd>
              </h2>
              {/* Q&A moderation plugs in here (F6). */}
              <p className="text-sm text-muted">{t("qa.soon")}</p>
            </section>
            <section className="flex flex-col gap-1 rounded-xl border border-neutral-200 bg-background p-5 text-sm">
              <h2 className="font-bold">{t("singleDisplay.title")}</h2>
              <p className="text-muted">{t("singleDisplay.body")}</p>
            </section>
          </aside>
        </div>

        <SlideStrip
          slides={slides}
          currentIndex={currentIndex}
          runs={runs}
          now={now}
          onSelect={controls.goTo}
        />
      </div>

      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
      {editing && activity && current && (
        <WordingDialog
          activity={activity}
          onSave={(body) => controls.editWording(current.id, body)}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
