"use client";

import { useTranslations } from "next-intl";
import type { ActivityRunDto, LiveActivity, LiveSlide } from "@moddeck/shared";
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
      {state === "results_shown" ? (
        <ActivityResults activity={activity} />
      ) : activity.type === "poll" ? (
        <PollOptions options={activity.options} />
      ) : null}
    </div>
  );
}

// More options than this would run off a 16:9 stage at the normal size, and the audience cannot
// scroll a projector.
const DENSE_OPTIONS = 6;

function OptionKey({ index, dense }: { index: number; dense: boolean }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-[0.9cqw] font-bold text-white",
        dense ? "size-[3cqw]" : "size-[4.2cqw]",
        optionColor(index),
      )}
    >
      {optionLetter(index)}
    </span>
  );
}

function PollOptions({ options }: { options: LiveActivity["options"] }) {
  const dense = options.length > DENSE_OPTIONS;
  return (
    <ol className={cn("grid grid-cols-2", dense ? "gap-[0.8cqw]" : "gap-[1.2cqw]")}>
      {options.map((option, index) => (
        <li
          key={option.id}
          className={cn(
            "flex min-w-0 items-center gap-[1.6cqw] rounded-[1.2cqw] border-[0.15cqw] border-neutral-200 px-[1.8cqw]",
            dense ? "py-[0.5cqw] text-[2.1cqw]" : "py-[1cqw] text-[2.6cqw]",
          )}
        >
          <OptionKey index={index} dense={dense} />
          <RichText source={option.label} className="min-w-0 flex-1" />
        </li>
      ))}
    </ol>
  );
}

/**
 * The result area (MD-15 P04, P05, P-Zero-responses). Students cannot answer yet, so a run has no
 * answers and this is the empty state. The live chart and word cloud replace it.
 */
function ActivityResults({ activity }: { activity: LiveActivity }) {
  const t = useTranslations("presenter.stage");
  if (activity.type !== "poll") {
    return (
      <p className="m-auto text-center text-[2.4cqw] font-semibold text-neutral-700">
        {t("noWords")}
      </p>
    );
  }
  const dense = activity.options.length > DENSE_OPTIONS;
  return (
    <>
      <ol
        className={cn(
          dense ? "grid grid-cols-2 gap-x-[2.4cqw] gap-y-[0.8cqw]" : "flex flex-col gap-[1.4cqw]",
        )}
      >
        {activity.options.map((option, index) => (
          <li
            key={option.id}
            className={cn(
              "grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-[1.6cqw]",
              dense ? "text-[1.8cqw]" : "text-[2.4cqw]",
            )}
          >
            <span className="flex min-w-0 items-center gap-[1.1cqw]">
              <OptionKey index={index} dense={dense} />
              <RichText source={option.label} className="min-w-0 flex-1" />
            </span>
            <span
              className={cn(
                "rounded-[0.6cqw] border-[0.15cqw] border-dashed border-neutral-300 bg-neutral-100",
                dense ? "h-[2.4cqw]" : "h-[4cqw]",
              )}
            />
            <span className="font-bold text-neutral-500 tabular-nums">0%</span>
          </li>
        ))}
      </ol>
      <p className="mt-auto text-center text-[2cqw] font-semibold text-neutral-700">
        {t("noVotes")}
      </p>
    </>
  );
}
