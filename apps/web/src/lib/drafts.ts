"use client";

import { useCallback, useState } from "react";

// Typed text that must survive a dropped connection, a reload and a locked phone:
// word, question, nickname (MD-5 rule 6, technical design §2.5 `drafts`).
// Storage can be blocked (private mode) or full, so every access is guarded and
// the field still works without it.

const PREFIX = "moddeck:draft:";

export function readDraft(key: string): string {
  try {
    return window.localStorage.getItem(PREFIX + key) ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(PREFIX + key, value);
    else window.localStorage.removeItem(PREFIX + key);
  } catch {
    // Ignore: the text stays in the field, it is only not kept across a reload.
  }
}

/** Like useState for a text field, saved on every change. Call `clear` after the server confirms. */
export function useDraft(key: string) {
  const [value, setValue] = useState(() => (typeof window === "undefined" ? "" : readDraft(key)));
  const update = useCallback(
    (next: string) => {
      setValue(next);
      writeDraft(key, next);
    },
    [key],
  );
  const clear = useCallback(() => update(""), [update]);
  return [value, update, clear] as const;
}
