"use client";

import { useTranslations } from "next-intl";
import type { ActivityRunDto, LiveSlide } from "@moddeck/shared";
import { RichText } from "@/components/content/RichText";
import { SlideRenderer } from "@/components/content/SlideRenderer";
import { cn } from "@/lib/cn";
import { formatDuration, secondsLeft } from "@/lib/live/clock";

// Answer A = chart-1, B = chart-2, ... (MD-11 categorical palette), with the letter as well.
const CHART = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-chart-6"];
export const optionLetter = (index: number) => String.fromCharCode(65 + index);
export const optionColor = (index: number) => CHART[index % CHART.length];

/**
 * One live slide on a 16:9 stage (MD-15 P02–P05): a content slide through SlideRenderer, an
 * activity with its question, options and state. The audience screen draws it full size, the
 * presenter as its "now showing" preview. Sizes are `cqw`, so both are the same picture.
 */
export function LiveStage({
  slide,
  run,
  now,
  className,
  thumbnail = false,
}: {
  slide: LiveSlide;
  run?: ActivityRunDto;
  now: number;
  className?: string;
  thumbnail?: boolean;
}) {
  if (slide.kind === "content" || !slide.activity) {
    return (
      <SlideRenderer
        slide={{ kind: "content", elements: slide.elements }}
        mode={thumbnail ? "thumbnail" : "stage"}
        className={className}
      />
    );
  }
  return (
    <div
      aria-hidden={thumbnail ? true : undefined}
      className={cn(
        "@container relative aspect-video w-full overflow-hidden rounded-lg border border-neutral-200 bg-background text-foreground",
        thumbnail && "pointer-events-none select-none",
        className,
      )}
    >
      <ActivityView slide={slide} run={run} now={now} />
    </div>
  );
}

function ActivityView({
  slide,
  run,
  now,
}: {
  slide: LiveSlide;
  run?: ActivityRunDto;
  now: number;
}) {
  const t = useTranslations("presenter.stage");
  const activity = slide.activity!;
  const state = run?.state ?? "draft";
  const left = state === "live" && run?.endsAt ? secondsLeft(run.endsAt, now) : null;

  return (
    <div className="absolute inset-0 flex flex-col gap-[2.2cqw] p-[5cqw]">
      <div className="flex items-center gap-[1.5cqw] text-[2cqw] font-semibold">
        <span className="rounded-full bg-primary-100 px-[1.6cqw] py-[0.5cqw] text-primary-800">
          {t(`kind.${activity.type}`)}
        </span>
        <span className="text-muted">{t(`state.${state}`)}</span>
        {left !== null && (
          <span
            className={cn(
              "ml-auto rounded-full px-[1.6cqw] py-[0.5cqw] font-mono tabular-nums",
              left <= 10 ? "bg-error-600 text-white" : "bg-neutral-900 text-white",
            )}
          >
            {formatDuration(left)}
          </span>
        )}
      </div>
      <RichText source={activity.prompt} className="text-[4cqw] leading-[1.3] font-semibold" />
      {activity.type === "poll" ? (
        <ol className="flex flex-col gap-[1.2cqw]">
          {activity.options.map((option, index) => (
            <li
              key={option.id}
              className="flex items-center gap-[1.6cqw] rounded-[1.2cqw] border-[0.15cqw] border-neutral-200 px-[1.8cqw] py-[1cqw] text-[2.6cqw]"
            >
              <span
                className={cn(
                  "grid size-[4.2cqw] shrink-0 place-items-center rounded-[0.9cqw] font-bold text-white",
                  optionColor(index),
                )}
              >
                {optionLetter(index)}
              </span>
              <RichText source={option.label} className="min-w-0 flex-1" />
            </li>
          ))}
        </ol>
      ) : null}
      {state === "results_shown" && (
        // Answers are counted once students can send them; until then a run has none.
        <p className="mt-auto text-center text-[2.4cqw] text-muted">
          {t(activity.type === "poll" ? "noVotes" : "noWords")}
        </p>
      )}
    </div>
  );
}
