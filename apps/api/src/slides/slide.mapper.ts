import { isCodeLanguage, type SlideDto } from "@moddeck/shared";
import type { Prisma } from "../generated/prisma/client";

// Slide rows always come with the activity wording, so the editor can name an activity slide.
export const slideArgs = {
  include: { activity: { select: { type: true, prompt: true } } },
} satisfies Prisma.SlideDefaultArgs;

type SlideRow = Prisma.SlideGetPayload<typeof slideArgs>;

export function toSlideDto(slide: SlideRow): SlideDto {
  return {
    id: slide.id,
    position: slide.position,
    kind: slide.kind,
    content: slide.content,
    language: slide.language && isCodeLanguage(slide.language) ? slide.language : null,
    imageRef: slide.imageRef,
    activity: slide.activity,
    updatedAt: slide.updatedAt.toISOString(),
  };
}
