"use client";

import { useTranslations } from "next-intl";
import type { ActivityRunDto, LiveActivity, LiveSlide, PollTally } from "@moddeck/shared";
import { RichText } from "@/components/content/RichText";
import { SlideRenderer } from "@/components/content/SlideRenderer";
import { DENSE_OPTIONS, OptionKey, PollChart } from "@/components/poll/PollChart";
import { cn } from "@/lib/cn";
import { formatDuration, secondsLeft } from "@/lib/live/clock";

/**
 * One live slide on a 16:9 stage (MD-15 P02–P05): a content slide through SlideRenderer, an
 * activity with its question, options and state. The audience screen draws it full size, the
 * presenter as its "now showing" preview. Sizes are `cqw`, so both are the same picture.
 */
export function LiveStage({
  slide,
  run,
  tally,
  liveChart = false,
  now,
  className,
  thumbnail = false,
}: {
  slide: LiveSlide;
  run?: ActivityRunDto;
  /** The counts of this run. Without them (a thumbnail) the stage draws no chart. */
  tally?: PollTally;
  /** Draw the chart while voting is open ("show results live", MD-5 §7.1). */
  liveChart?: boolean;
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
      <ActivityView slide={slide} run={run} tally={tally} liveChart={liveChart} now={now} />
    </div>
  );
}

function ActivityView({
  slide,
  run,
  tally,
  liveChart,
  now,
}: {
  slide: LiveSlide;
  run?: ActivityRunDto;
  tally?: PollTally;
  liveChart: boolean;
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
      {activity.type !== "poll" ? (
        state === "results_shown" && (
          <p className="m-auto text-center text-[2.4cqw] font-semibold text-neutral-700">
            {t("noWords")}
          </p>
        )
      ) : tally && (state === "results_shown" || (state === "live" && liveChart)) ? (
        <PollChart options={activity.options} tally={tally} scale="stage" />
      ) : (
        <PollOptions options={activity.options} />
      )}
      {activity.type === "poll" && tally && (state === "live" || state === "closed") && (
        <p className="mt-auto text-center text-[2cqw] font-semibold text-neutral-700 tabular-nums">
          {state === "closed" && `${t("votingClosed")} · `}
          {t("answered", { count: tally.answered })}
        </p>
      )}
    </div>
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
