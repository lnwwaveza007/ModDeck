// A poll while the host writes it. The api takes only a complete poll, so the editor keeps what is
// typed here and saves it once it is complete. A row has a `key` of its own because a new option
// has no id until the first save returns one.

import {
  POLL_OPTIONS_MAX,
  POLL_OPTIONS_MIN,
  type ActivityWordingBody,
  type SlideDto,
} from "@moddeck/shared";

export interface PollRow {
  key: string;
  id?: string;
  label: string;
}

export interface PollDraft {
  prompt: string;
  rows: PollRow[];
}

export const newPollRow = (): PollRow => ({ key: crypto.randomUUID(), label: "" });

export function pollDraftOf(slide: Pick<SlideDto, "activity">): PollDraft {
  const rows: PollRow[] = (slide.activity?.options ?? []).map(({ id, label }) => ({
    key: id,
    id,
    label,
  }));
  while (rows.length < POLL_OPTIONS_MIN) rows.push(newPollRow());
  return { prompt: slide.activity?.prompt ?? "", rows };
}

export function isPollComplete({ prompt, rows }: PollDraft): boolean {
  return (
    prompt.trim().length > 0 &&
    rows.length >= POLL_OPTIONS_MIN &&
    rows.length <= POLL_OPTIONS_MAX &&
    rows.every((row) => row.label.trim().length > 0)
  );
}

export const pollBody = ({ prompt, rows }: PollDraft): ActivityWordingBody => ({
  prompt,
  options: rows.map(({ id, label }) => (id ? { id, label } : { label })),
});

/** Gives the rows that were sent the ids the server made. Rows added since then stay without. */
export function withSavedIds(
  draft: PollDraft,
  sent: PollRow[],
  saved: { id: string }[],
): PollDraft {
  const ids = new Map(sent.map((row, index) => [row.key, saved[index]?.id]));
  return {
    ...draft,
    rows: draft.rows.map((row) => (row.id ? row : { ...row, id: ids.get(row.key) })),
  };
}
