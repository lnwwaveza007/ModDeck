"use client";

import { useTranslations } from "next-intl";
import type { LiveQuestion } from "@moddeck/shared";
import { RichText } from "@/components/content/RichText";
import { cn } from "@/lib/cn";

/**
 * The question the host pinned, large over the slide (F6). It stays through slide changes until
 * the host unpins, answers or hides it, and its vote count follows the room. Sizes are `cqw` of the
 * nearest container, so the projector and the presenter preview show the same picture.
 */
export function PinnedQuestion({
  question,
  className,
}: {
  question: LiveQuestion;
  className?: string;
}) {
  const t = useTranslations("screen.question");
  return (
    <div
      className={cn(
        "absolute inset-0 grid place-items-center bg-neutral-900/70 p-[4cqw]",
        className,
      )}
    >
      <figure
        aria-label={t("label")}
        className="flex w-full max-w-[80cqw] flex-col gap-[2.2cqw] rounded-[2cqw] bg-background p-[4cqw] text-foreground shadow-lg"
      >
        <figcaption className="flex items-center gap-[1.5cqw] text-[1.9cqw] font-semibold text-neutral-700">
          <span className="rounded-full bg-primary-100 px-[1.6cqw] py-[0.5cqw] text-primary-800">
            {t("label")}
          </span>
          <span className="min-w-0 truncate">
            {question.anonymous ? t("anonymous") : question.author}
          </span>
          <span className="ml-auto rounded-full bg-neutral-900 px-[1.6cqw] py-[0.5cqw] text-white tabular-nums">
            ▲ {t("votes", { count: question.votes })}
          </span>
        </figcaption>
        <RichText
          source={question.text}
          className="line-clamp-6 text-[4.2cqw] leading-[1.3] font-semibold wrap-break-word"
        />
      </figure>
    </div>
  );
}
