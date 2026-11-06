"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import type { ActivityRunDto, LiveSlide } from "@moddeck/shared";
import { cn } from "@/lib/cn";
import { runOf } from "@/lib/live/use-live-session";
import { LiveStage } from "./LiveStage";

/**
 * Every slide of the deck in order. One click jumps there, so a wrong advance is fixed in one
 * move. The slide on screen is marked, and an activity shows its state under the thumbnail.
 */
export function SlideStrip({
  slides,
  currentIndex,
  runs,
  now,
  onSelect,
}: {
  slides: LiveSlide[];
  currentIndex: number;
  runs: Record<string, ActivityRunDto>;
  now: number;
  onSelect: (index: number) => void;
}) {
  const t = useTranslations("presenter.strip");
  const ta = useTranslations("presenter.activity");
  const currentRef = useRef<HTMLLIElement>(null);

  // Keep the slide on screen visible as the host moves through the deck.
  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [currentIndex]);

  return (
    <nav aria-label={t("label")} className="rounded-xl border border-neutral-200 bg-background p-2">
      <ol className="flex gap-3 overflow-x-auto">
        {slides.map((slide, index) => {
          const current = index === currentIndex;
          const state = slide.activity ? runOf(runs, slide.activity.id).state : null;
          return (
            <li key={slide.id} ref={current ? currentRef : undefined} className="w-36 shrink-0">
              <button
                type="button"
                aria-current={current ? "true" : undefined}
                aria-label={t("goTo", { index: index + 1 })}
                onClick={() => onSelect(index)}
                className={cn(
                  "flex w-full flex-col gap-1 rounded-lg p-1 text-left focus-visible:outline-2 focus-visible:outline-ring",
                  current ? "bg-primary-50 ring-2 ring-primary-600" : "hover:bg-neutral-100",
                )}
              >
                <LiveStage
                  slide={slide}
                  now={now}
                  thumbnail
                  run={slide.activity ? runOf(runs, slide.activity.id) : undefined}
                />
                <span className="flex items-center justify-between gap-1 px-1 text-xs">
                  <span className="font-semibold">{index + 1}</span>
                  {state && state !== "draft" && (
                    <span className="truncate text-muted">{ta(`state.${state}`)}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
