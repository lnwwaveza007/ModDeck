"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { DEFAULT_CODE_LANGUAGE, type SlideDto } from "@moddeck/shared";
import { cn } from "@/lib/cn";
import { slideImageUrl } from "@/lib/api/slides";
import { CodeBlock } from "./CodeBlock";
import { MathBlock } from "./MathBlock";
import { RichText } from "./RichText";

export type RenderableSlide = Pick<SlideDto, "kind" | "content" | "language" | "imageRef"> & {
  activity?: SlideDto["activity"];
};

/**
 * One slide on a 16:9 stage (F7, F8, technical design §2.4). The editor canvas, the thumbnails,
 * the presenter, the projector and the student screens all draw a slide through this component,
 * so text, code, math and images look the same everywhere.
 *
 * All sizes are container-query units (`cqw`, 1% of the stage width), so the layout is the same
 * at any size: a 160 px thumbnail is a scaled copy of the projector.
 *
 * - `stage`: long code and formulas scroll inside the stage, so they never shrink below a
 *   readable size.
 * - `thumbnail`: cropped, not interactive, hidden from screen readers.
 */
export function SlideRenderer({
  slide,
  mode = "stage",
  className,
}: {
  slide: RenderableSlide;
  mode?: "stage" | "thumbnail";
  className?: string;
}) {
  const thumbnail = mode === "thumbnail";

  return (
    <div
      aria-hidden={thumbnail ? true : undefined}
      className={cn(
        "@container relative aspect-video w-full overflow-hidden rounded-lg border border-neutral-200 bg-background text-foreground",
        thumbnail && "pointer-events-none select-none **:overflow-hidden!",
        className,
      )}
    >
      <div
        className={cn(
          "absolute inset-0 flex flex-col p-[5cqw]",
          thumbnail ? "overflow-hidden" : "overflow-auto",
        )}
      >
        <SlideBody slide={slide} hint={!thumbnail} />
      </div>
    </div>
  );
}

function SlideBody({ slide, hint }: { slide: RenderableSlide; hint: boolean }) {
  const t = useTranslations("content");
  const content = slide.content ?? "";

  const empty = (label: string) =>
    hint ? <p className="m-auto text-[3cqw] text-neutral-500">{label}</p> : null;

  switch (slide.kind) {
    case "text":
      if (content.trim() === "") return empty(t("empty.text"));
      return <RichText source={content} className="text-[3.4cqw] leading-[1.5]" />;

    case "code":
      if (content.trim() === "") return empty(t("empty.code"));
      return (
        <CodeBlock
          source={content}
          language={slide.language ?? DEFAULT_CODE_LANGUAGE}
          className="text-[2.2cqw]"
        />
      );

    case "math":
      if (content.trim() === "") return empty(t("empty.math"));
      return (
        <div className="m-auto flex w-full justify-center text-[4.8cqw]">
          <MathBlock latex={content} />
        </div>
      );

    case "image":
      if (!slide.imageRef) return empty(t("empty.image"));
      return (
        <div className="relative min-h-0 flex-1">
          <Image
            src={slideImageUrl(slide.imageRef)}
            alt={t("imageAlt")}
            fill
            unoptimized
            sizes="100vw"
            className="object-contain"
          />
        </div>
      );

    case "poll":
    case "word_cloud":
      return (
        <div className="m-auto flex max-w-full flex-col items-center gap-[1.5cqw] text-center">
          <span className="rounded-full bg-primary-100 px-[2cqw] py-[0.6cqw] text-[2.4cqw] font-semibold text-primary-800">
            {t(`activity.${slide.kind}`)}
          </span>
          {slide.activity?.prompt ? (
            <RichText source={slide.activity.prompt} className="text-[4cqw] leading-[1.4]" />
          ) : (
            hint && <p className="text-[2.8cqw] text-neutral-500">{t("activity.noPrompt")}</p>
          )}
        </div>
      );
  }
}
