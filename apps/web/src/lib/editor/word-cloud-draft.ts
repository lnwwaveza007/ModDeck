// A word cloud while the host writes it: the prompt and how many words each student may send.
// Like a poll, it reaches the server once it is complete (a prompt is written).

import {
  WORD_ENTRIES_DEFAULT,
  WORD_ENTRIES_MAX,
  WORD_ENTRIES_MIN,
  type ActivityWordingBody,
  type SlideDto,
} from "@moddeck/shared";

export interface WordCloudDraft {
  prompt: string;
  maxEntries: number;
}

export function wordCloudDraftOf(slide: Pick<SlideDto, "activity">): WordCloudDraft {
  return {
    prompt: slide.activity?.prompt ?? "",
    maxEntries: slide.activity?.maxEntries ?? WORD_ENTRIES_DEFAULT,
  };
}

export const isWordCloudComplete = ({ prompt, maxEntries }: WordCloudDraft): boolean =>
  prompt.trim().length > 0 &&
  Number.isInteger(maxEntries) &&
  maxEntries >= WORD_ENTRIES_MIN &&
  maxEntries <= WORD_ENTRIES_MAX;

export const wordCloudBody = ({ prompt, maxEntries }: WordCloudDraft): ActivityWordingBody => ({
  prompt,
  maxEntries,
});
