import {
  SLIDE_ELEMENTS_MAX,
  slideElementSchema,
  type LiveActivity,
  type SlideDto,
  type SlideElement,
} from "@moddeck/shared";
import type { Prisma } from "../generated/prisma/client";

// What a screen needs to draw an activity. The live view, the phones and the wording editor all
// read it, so one select keeps them the same.
export const liveActivitySelect = {
  id: true,
  type: true,
  prompt: true,
  allowAnswerChange: true,
  maxEntriesPerPerson: true,
  options: { orderBy: { position: "asc" }, select: { id: true, label: true } },
} satisfies Prisma.ActivitySelect;

type ActivityRow = Prisma.ActivityGetPayload<{ select: typeof liveActivitySelect }>;

export const toLiveActivity = ({
  maxEntriesPerPerson,
  ...activity
}: ActivityRow): LiveActivity => ({
  ...activity,
  maxEntries: maxEntriesPerPerson,
});

// Slide rows always come with the activity wording, so the editor can show and edit it.
export const slideArgs = {
  include: {
    activity: {
      select: {
        id: true,
        type: true,
        prompt: true,
        maxEntriesPerPerson: true,
        options: { orderBy: { position: "asc" }, select: { id: true, label: true } },
      },
    },
  },
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
    activity: slide.activity && {
      id: slide.activity.id,
      type: slide.activity.type,
      prompt: slide.activity.prompt,
      options: slide.activity.options,
      maxEntries: slide.activity.maxEntriesPerPerson,
    },
    updatedAt: slide.updatedAt.toISOString(),
  };
}
