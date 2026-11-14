"use client";

import { useEffect, useId, useState, type RefObject } from "react";
import { useTranslations } from "next-intl";
import {
  ACTIVITY_TIMER_MAX_SECONDS,
  ACTIVITY_TIMER_MIN_SECONDS,
  ACTIVITY_TIMER_PRESETS,
  availableActivityActions,
  type ActivityAction,
  type ActivityRunDto,
  type LiveActivity,
  type PollTally,
  type WordCloudTally,
  type WordCount,
} from "@moddeck/shared";
import { RichText } from "@/components/content/RichText";
import { PollChart } from "@/components/poll/PollChart";
import { WordCloud } from "@/components/wordcloud/WordCloud";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatDuration, secondsLeft } from "@/lib/live/clock";
import { Kbd } from "./Kbd";
import { WordModeration } from "./WordModeration";

const STATE_TONE: Record<ActivityRunDto["state"], BadgeTone> = {
  draft: "neutral",
  live: "success",
  closed: "warning",
  results_shown: "primary",
};

// The key that does each action (see lib/live/shortcuts.ts).
const ACTION_KEY: Record<ActivityAction, string> = {
  start: "A",
  stop: "A",
  reopen: "A",
  show_results: "S",
  hide_results: "S",
};

/** Timer choice: no timer, a preset, or a custom number of seconds. */
type TimerChoice = "none" | `${number}` | "custom";

export function parseTimer(choice: TimerChoice, custom: string): number | undefined | null {
  if (choice === "none") return undefined;
  const seconds = choice === "custom" ? Number(custom) : Number(choice);
  if (!Number.isInteger(seconds)) return null;
  if (seconds < ACTIVITY_TIMER_MIN_SECONDS || seconds > ACTIVITY_TIMER_MAX_SECONDS) return null;
  return seconds;
}

/**
 * MD-15 H05/H07 activity control card: the state, the buttons for it, the countdown, and the live
 * chart. This chart is for the host: it always shows, whatever the audience screen shows. An
 * activity starts only when the host presses Start: showing its slide does nothing.
 */
export function ActivityControls({
  activity,
  run,
  tally,
  cloud,
  hiddenWords,
  onSetWordHidden,
  liveChart,
  onLiveChart,
  now,
  onAct,
  onEditWording,
  durationRef,
}: {
  activity: LiveActivity;
  run: ActivityRunDto;
  tally: PollTally;
  /** Word cloud only: the words of the run and the ones the host hid. */
  cloud: WordCloudTally;
  hiddenWords: WordCount[];
  onSetWordHidden: (key: string, hidden: boolean) => Promise<void>;
  liveChart: boolean;
  onLiveChart: () => void;
  now: number;
  onAct: (action: ActivityAction, durationSeconds?: number) => Promise<void>;
  onEditWording: () => void;
  /** Gets the chosen timer, so the A key starts with it too. null: the custom value is invalid. */
  durationRef?: RefObject<number | undefined | null>;
}) {
  const t = useTranslations("presenter.activity");
  const [busy, setBusy] = useState(false);
  const [timer, setTimer] = useState<TimerChoice>("none");
  const [custom, setCustom] = useState("90");
  const timerId = useId();
  const customId = useId();

  const actions = availableActivityActions(run.state);
  const startsRun = actions.includes("start") || actions.includes("reopen");
  const duration = parseTimer(timer, custom);
  const left = run.state === "live" && run.endsAt ? secondsLeft(run.endsAt, now) : null;
  useEffect(() => {
    if (durationRef) durationRef.current = duration;
  });

  const press = async (action: ActivityAction) => {
    if (busy) return;
    setBusy(true);
    try {
      await onAct(
        action,
        action === "start" || action === "reopen" ? (duration ?? undefined) : undefined,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label={t("label")}
      className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-background p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={STATE_TONE[run.state]}>{t(`state.${run.state}`)}</Badge>
        <h2 className="flex min-w-0 flex-1 items-baseline gap-1 font-semibold">
          <span className="shrink-0">{t(`kind.${activity.type}`)} ·</span>
          <RichText source={activity.prompt} className="min-w-0 flex-1" />
        </h2>
        {left !== null && (
          <span
            role="timer"
            aria-label={t("timeLeft", { time: formatDuration(left) })}
            className="rounded-md bg-neutral-900 px-3 py-1 font-mono text-lg font-semibold text-white tabular-nums"
          >
            {formatDuration(left)}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {startsRun && (
          <div className="flex flex-col gap-1">
            <label htmlFor={timerId} className="text-sm text-muted">
              {t("timer")}
            </label>
            <select
              id={timerId}
              value={timer}
              onChange={(event) => setTimer(event.target.value as TimerChoice)}
              className="h-11 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="none">{t("noTimer")}</option>
              {ACTIVITY_TIMER_PRESETS.map((seconds) => (
                <option key={seconds} value={String(seconds)}>
                  {formatDuration(seconds)}
                </option>
              ))}
              <option value="custom">{t("customTimer")}</option>
            </select>
          </div>
        )}
        {startsRun && timer === "custom" && (
          <div className="flex flex-col gap-1">
            <label htmlFor={customId} className="text-sm text-muted">
              {t("seconds")}
            </label>
            <input
              id={customId}
              type="number"
              inputMode="numeric"
              min={ACTIVITY_TIMER_MIN_SECONDS}
              max={ACTIVITY_TIMER_MAX_SECONDS}
              value={custom}
              aria-invalid={duration === null}
              onChange={(event) => setCustom(event.target.value)}
              className="h-11 w-24 rounded-md border border-border bg-background px-3 text-sm aria-invalid:border-error-600"
            />
          </div>
        )}
        {actions.map((action) => (
          <Button
            key={action}
            variant={action === "start" || action === "show_results" ? "primary" : "secondary"}
            disabled={busy || ((action === "start" || action === "reopen") && duration === null)}
            onClick={() => void press(action)}
          >
            {t(`action.${action}`)} <Kbd>{ACTION_KEY[action]}</Kbd>
          </Button>
        ))}
        <Button variant="ghost" className="ml-auto" onClick={onEditWording}>
          {t("editWording")}
        </Button>
      </div>
      {duration === null && startsRun && (
        <p className="text-sm text-error-700">
          {t("timerRange", { min: ACTIVITY_TIMER_MIN_SECONDS, max: ACTIVITY_TIMER_MAX_SECONDS })}
        </p>
      )}
      <p className="text-sm text-muted">{t(`hint.${run.state}`)}</p>
      {activity.type === "poll" && run.state !== "draft" && (
        <div className="flex flex-col gap-3 border-t border-neutral-200 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="mr-auto text-sm font-semibold tabular-nums">
              {t("answered", { count: tally.answered })}
            </p>
            {run.state === "live" && (
              <Button variant="ghost" aria-pressed={liveChart} onClick={onLiveChart}>
                {t("liveChart")} <Kbd>L</Kbd>
              </Button>
            )}
          </div>
          <PollChart options={activity.options} tally={tally} scale="panel" />
        </div>
      )}
      {activity.type === "word_cloud" && run.state !== "draft" && (
        <div className="flex flex-col gap-3 border-t border-neutral-200 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="mr-auto text-sm font-semibold tabular-nums">
              {t("wordsSent", { count: cloud.entries })}
            </p>
            {run.state === "live" && (
              <Button variant="ghost" aria-pressed={liveChart} onClick={onLiveChart}>
                {t("liveCloud")} <Kbd>L</Kbd>
              </Button>
            )}
          </div>
          {cloud.words.length > 0 && (
            <WordCloud
              words={cloud.words}
              scale="panel"
              className="min-h-32 rounded-lg bg-neutral-50 p-3"
            />
          )}
          <WordModeration
            words={cloud.words}
            hiddenWords={hiddenWords}
            onSetHidden={onSetWordHidden}
          />
        </div>
      )}
    </section>
  );
}
