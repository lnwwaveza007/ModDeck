"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from "react";
import type { SlideDto, SlideElement } from "@moddeck/shared";
import { cn } from "@/lib/cn";
import { slideImageUrl } from "@/lib/api/slides";
import { CodeBlock } from "./CodeBlock";
import { MathBlock } from "./MathBlock";
import { RichText } from "./RichText";

export type RenderableSlide = Pick<SlideDto, "kind" | "elements"> & {
  activity?: SlideDto["activity"];
};

/**
 * What the editor adds around one element: pointer handlers and an outline in `props`, resize
 * handles in `handles`, or an editor in place of the content in `content`.
 */
export interface FrameDecoration {
  props?: HTMLAttributes<HTMLDivElement>;
  handles?: ReactNode;
  content?: ReactNode;
}

/**
 * One slide on a 16:9 stage (F7, F8, technical design §2.4). The editor canvas, the thumbnails,
 * the presenter, the projector and the student screens all draw a slide through this component,
 * so text, code, formulas and images look the same everywhere.
 *
 * Elements sit at percent positions of the stage, and every size is a container-query unit
 * (`cqw`, 1% of the stage width). The layout is therefore the same at any size: a 160 px thumbnail
 * is a scaled copy of the projector.
 *
 * - `stage`: the real thing. Long code scrolls inside its box.
 * - `thumbnail`: cropped, not interactive, hidden from screen readers.
 *
 * The editor passes `decorate` and `overlay` to make the stage editable. Without them this is
 * the read-only view the audience sees.
 */
export function SlideRenderer({
  slide,
  mode = "stage",
  className,
  placeholders = false,
  decorate,
  overlay,
  stageRef,
  stageProps,
}: {
  slide: RenderableSlide;
  mode?: "stage" | "thumbnail";
  className?: string;
  /** Show a hint in an empty element. For the editor. */
  placeholders?: boolean;
  decorate?: (element: SlideElement) => FrameDecoration;
  overlay?: ReactNode;
  stageRef?: Ref<HTMLDivElement>;
  stageProps?: HTMLAttributes<HTMLDivElement>;
}) {
  const thumbnail = mode === "thumbnail";
  const { className: stageClass, ...restStageProps } = stageProps ?? {};

  return (
    <div
      ref={stageRef}
      aria-hidden={thumbnail ? true : undefined}
      {...restStageProps}
      className={cn(
        "@container relative aspect-video w-full overflow-hidden rounded-lg border border-neutral-200 bg-background text-foreground",
        // No scrollbars in a thumbnail. Never `overflow: hidden` on every descendant: KaTeX builds
        // formulas from zero-size boxes that hang out of their parents, and clips them away.
        thumbnail && "pointer-events-none select-none **:[scrollbar-width:none]",
        stageClass,
        className,
      )}
    >
      {slide.kind === "content" ? (
        slide.elements.map((element) => (
          <ElementFrame
            key={element.id}
            element={element}
            placeholders={placeholders && !thumbnail}
            decoration={decorate?.(element)}
          />
        ))
      ) : (
        <div className="absolute inset-0 flex flex-col p-[5cqw]">
          <ActivityPlaceholder slide={slide} hint={!thumbnail} />
        </div>
      )}
      {overlay}
    </div>
  );
}

function ElementFrame({
  element,
  placeholders,
  decoration,
}: {
  element: SlideElement;
  placeholders: boolean;
  decoration?: FrameDecoration;
}) {
  const fixedHeight =
    element.type === "image" || (element.type === "code" && element.h !== undefined);
  const { className, style, ...props } = decoration?.props ?? {};
  const frameStyle: CSSProperties = {
    left: `${element.x}%`,
    top: `${element.y}%`,
    width: `${element.w}%`,
    height: fixedHeight ? `${(element as { h: number }).h}%` : undefined,
    ...style,
  };

  return (
    <div
      data-element-id={element.id}
      data-element-type={element.type}
      {...props}
      className={cn("absolute", className)}
      style={frameStyle}
    >
      {decoration?.content ?? <ElementContent element={element} placeholders={placeholders} />}
      {decoration?.handles}
    </div>
  );
}

/** The content of one element, without its frame. */
export function ElementContent({
  element,
  placeholders,
}: {
  element: SlideElement;
  placeholders: boolean;
}) {
  const t = useTranslations("content");
  const hint = (label: string) =>
    placeholders ? <p className="text-neutral-400">{label}</p> : null;
  const fontSize = `${element.type === "image" ? 0 : element.size}cqw`;

  switch (element.type) {
    case "text":
      return (
        <div
          style={{
            fontSize,
            textAlign: element.align,
            fontWeight: element.bold ? 700 : 400,
            lineHeight: 1.4,
          }}
        >
          {element.text.trim() === "" ? (
            hint(t("placeholder.text"))
          ) : (
            <RichText source={element.text} />
          )}
        </div>
      );

    case "code": {
      const fixed = element.h !== undefined;
      return (
        <div style={{ fontSize }} className={cn(fixed && "h-full")}>
          {element.code.trim() === "" ? (
            hint(t("placeholder.code"))
          ) : (
            <CodeBlock
              source={element.code}
              language={element.language}
              className={cn(fixed && "h-full")}
            />
          )}
        </div>
      );
    }

    case "math":
      return (
        <div
          style={{ fontSize }}
          data-align={element.align}
          className={cn(
            "flex",
            element.align === "center" && "justify-center",
            element.align === "right" && "justify-end",
          )}
        >
          {element.latex.trim() === "" ? (
            hint(t("placeholder.math"))
          ) : (
            // A formula wider than its box spills out of it, centered or flush to the side, and
            // is never clipped or scrolled: the audience cannot scroll a projector.
            <MathBlock latex={element.latex} scroll={false} />
          )}
        </div>
      );

    case "image":
      return (
        <div className="relative h-full w-full">
          {element.imageRef ? (
            <Image
              src={slideImageUrl(element.imageRef)}
              alt={t("imageAlt")}
              fill
              unoptimized
              sizes="100vw"
              className="object-contain"
              draggable={false}
            />
          ) : (
            placeholders && (
              <div className="grid h-full w-full place-items-center rounded-md border border-dashed border-neutral-300 bg-neutral-50 text-[2.4cqw] text-neutral-500">
                {t("placeholder.image")}
              </div>
            )
          )}
        </div>
      );
  }
}

function ActivityPlaceholder({ slide, hint }: { slide: RenderableSlide; hint: boolean }) {
  const t = useTranslations("content");
  if (slide.kind === "content") return null;

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
