"use client";

import { useTranslations } from "next-intl";
import type { ActivityOptionDto, PollTally } from "@moddeck/shared";
import { RichText } from "@/components/content/RichText";
import { cn } from "@/lib/cn";

// Answer A = chart-1, B = chart-2, ... (MD-11 categorical palette), with the letter as well: the
// palette repeats after six, and the letter still tells two options apart.
const CHART = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-chart-6"];
export const optionLetter = (index: number) => String.fromCharCode(65 + index);
export const optionColor = (index: number) => CHART[index % CHART.length];

// More options than this would run off a 16:9 stage at the normal size, and the audience cannot
// scroll a projector.
export const DENSE_OPTIONS = 6;

/** The colored letter of an option on a 16:9 stage. Sizes are `cqw`. */
export function OptionKey({ index, dense }: { index: number; dense: boolean }) {
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

export const percentOf = (votes: number, answered: number) =>
  answered > 0 ? Math.round((votes / answered) * 100) : 0;

/**
 * The live bar chart (MD-11 "Card + chart"). `stage` sizes with a 16:9 stage (projector and
 * presenter preview), `panel` is for normal page flow (presenter card and student phone). It holds
 * only the counts it gets, so every screen draws the same numbers.
 */
export function PollChart({
  options,
  tally,
  scale,
  mine,
}: {
  options: ActivityOptionDto[];
  tally: PollTally;
  scale: "stage" | "panel";
  /** The option of this student, marked on their phone. */
  mine?: string | null;
}) {
  const t = useTranslations("presenter.stage");
  return scale === "stage" ? (
    <StageChart options={options} tally={tally} noVotes={t("noVotes")} />
  ) : (
    <PanelChart options={options} tally={tally} mine={mine} youLabel={t("yourAnswer")} />
  );
}

function StageChart({
  options,
  tally,
  noVotes,
}: {
  options: ActivityOptionDto[];
  tally: PollTally;
  noVotes: string;
}) {
  const dense = options.length > DENSE_OPTIONS;
  return (
    <>
      <ol
        className={cn(
          dense ? "grid grid-cols-2 gap-x-[2.4cqw] gap-y-[0.8cqw]" : "flex flex-col gap-[1.4cqw]",
        )}
      >
        {options.map((option, index) => {
          const votes = tally.votes[option.id] ?? 0;
          const percent = percentOf(votes, tally.answered);
          return (
            <li
              key={option.id}
              className={cn(
                // A fixed number column, so every bar starts and ends at the same place.
                "grid items-center gap-[1.6cqw]",
                dense
                  ? "grid-cols-[minmax(0,2fr)_minmax(0,3fr)_8cqw] text-[1.8cqw]"
                  : "grid-cols-[minmax(0,2fr)_minmax(0,3fr)_11cqw] text-[2.4cqw]",
              )}
            >
              <span className="flex min-w-0 items-center gap-[1.1cqw]">
                <OptionKey index={index} dense={dense} />
                <RichText source={option.label} className="min-w-0 flex-1" />
              </span>
              <span
                className={cn(
                  "overflow-hidden rounded-[0.6cqw] bg-neutral-100",
                  dense ? "h-[2.4cqw]" : "h-[4cqw]",
                )}
              >
                <span
                  className={cn(
                    "block h-full rounded-[0.6cqw] transition-[width] duration-150 motion-reduce:transition-none",
                    optionColor(index),
                  )}
                  style={{ width: `${percent}%` }}
                />
              </span>
              <span className="text-right font-bold tabular-nums">
                {percent}% · {votes}
              </span>
            </li>
          );
        })}
      </ol>
      {tally.answered === 0 && (
        <p className="mt-auto text-center text-[2cqw] font-semibold text-neutral-700">{noVotes}</p>
      )}
    </>
  );
}

function PanelChart({
  options,
  tally,
  mine,
  youLabel,
}: {
  options: ActivityOptionDto[];
  tally: PollTally;
  mine?: string | null;
  youLabel: string;
}) {
  return (
    <ol className="flex flex-col gap-3">
      {options.map((option, index) => {
        const votes = tally.votes[option.id] ?? 0;
        const percent = percentOf(votes, tally.answered);
        return (
          <li key={option.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-sm text-sm font-bold text-white",
                  optionColor(index),
                )}
              >
                {optionLetter(index)}
              </span>
              <RichText source={option.label} className="min-w-0 flex-1" />
              {option.id === mine && (
                <span className="rounded-full bg-primary-100 px-2 text-xs font-semibold text-primary-800">
                  {youLabel}
                </span>
              )}
              <span className="text-sm font-semibold tabular-nums">
                {percent}% · {votes}
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-sm bg-neutral-100">
              <div
                className={cn(
                  "h-full rounded-sm transition-[width] duration-150 motion-reduce:transition-none",
                  optionColor(index),
                )}
                style={{ width: `${percent}%` }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
