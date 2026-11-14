"use client";

import { useTranslations } from "next-intl";
import type { WordCount } from "@moddeck/shared";
import { cn } from "@/lib/cn";

// Colors of the chart palette (MD-11) that keep 4.5:1 on white, so the smallest word on a phone
// still reads. The color follows the word, not its rank, so it does not change as the cloud grows.
const COLORS = ["text-chart-1", "text-chart-4", "text-chart-6", "text-neutral-900"];

/** A fixed color for a word: the same on the projector, the host's screen and every phone. */
export function wordColor(key: string): string {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

/**
 * How many times the base size a word is drawn at. The most sent word is the largest, and a word
 * sent by twice as many people is larger: size only ever grows with the count. A long list is
 * drawn smaller as a whole, so the top 60 words still fit one stage.
 */
export function wordScale(count: number, max: number, total: number): number {
  const fit = total <= 12 ? 1 : total <= 24 ? 0.8 : total <= 40 ? 0.65 : 0.5;
  return (1 + 1.8 * Math.sqrt(count / Math.max(max, 1))) * fit;
}

/**
 * The word cloud (MD-5 §7.1). `stage` sizes with a 16:9 stage (projector and presenter preview),
 * `panel` is for normal page flow (presenter card and student phone). It draws only the words it
 * gets, so every screen draws the same cloud.
 *
 * Thai has no spaces and its vowels and tone marks sit above and below the line, so a word is
 * never wrapped or split, and the line height leaves room for the marks.
 */
export function WordCloud({
  words,
  scale,
  mine,
  className,
}: {
  words: WordCount[];
  scale: "stage" | "panel";
  /** Keys of the words this student sent, ringed on their phone. */
  mine?: ReadonlySet<string>;
  className?: string;
}) {
  const t = useTranslations("presenter.stage");
  const max = words.reduce((most, word) => Math.max(most, word.count), 1);
  const base = scale === "stage" ? "2.2cqw" : "1.125rem";

  return (
    <ul
      aria-label={t("cloud")}
      className={cn(
        "flex flex-wrap content-center items-center justify-center overflow-hidden",
        scale === "stage" ? "gap-x-[2.2cqw] gap-y-[0.4cqw]" : "gap-x-4 gap-y-1",
        className,
      )}
    >
      {words.map((word) => {
        const ratio = wordScale(word.count, max, words.length).toFixed(3);
        return (
          <li
            key={word.key}
            aria-label={t("wordCount", { word: word.text, count: word.count })}
            data-scale={ratio}
            className={cn(
              "font-semibold leading-[1.6] whitespace-nowrap transition-[font-size] duration-300 motion-reduce:transition-none",
              wordColor(word.key),
              mine?.has(word.key) && "rounded-lg px-[0.3em] ring-2 ring-primary-500",
            )}
            style={{ fontSize: `calc(${base} * ${ratio})` }}
          >
            {word.text}
          </li>
        );
      })}
    </ul>
  );
}
