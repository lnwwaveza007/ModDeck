import {
  SLIDE_ELEMENTS_MAX,
  slideElementSchema,
  type SlideDto,
  type SlideElement,
} from "@moddeck/shared";
import type { Prisma } from "../generated/prisma/client";

// Slide rows always come with the activity wording, so the editor can name an activity slide.
export const slideArgs = {
  include: { activity: { select: { type: true, prompt: true } } },
} satisfies Prisma.SlideDefaultArgs;

type SlideRow = Prisma.SlideGetPayload<typeof slideArgs>;

/**
 * Elements are written through slideElementsSchema, so an element that fails it was edited by
 * hand. It is skipped, and the rest of the slide still shows.
 */
function readElements(value: Prisma.JsonValue): SlideElement[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      const parsed = slideElementSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    })
    .slice(0, SLIDE_ELEMENTS_MAX);
}

export function toSlideDto(slide: SlideRow): SlideDto {
  // text, code, math and image are the kinds from before the canvas editor. The migration
  // turned them into content slides; any that is left shows as an empty one.
  const kind = slide.kind === "poll" || slide.kind === "word_cloud" ? slide.kind : "content";
  return {
    id: slide.id,
    position: slide.position,
    kind,
    elements: kind === "content" ? readElements(slide.elements) : [],
    activity: slide.activity,
    updatedAt: slide.updatedAt.toISOString(),
  };
}
