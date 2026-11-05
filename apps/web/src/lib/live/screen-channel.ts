"use client";

// What the audience screen shows on top of the slide (blank, join info) is screen-only state:
// the students never need it. Presenter control and the audience screen are windows of the same
// browser, so they share it through localStorage instead of the server. A window that opens or
// refreshes later reads the same value, and the `storage` event tells the other windows.

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

export interface ScreenLayers {
  blank: boolean;
  /** The full join screen with the big PIN and QR code (MD-15 P01). */
  join: boolean;
  /** The small corner bar with the join address and PIN (MD-15 P02). */
  joinBar: boolean;
}

const keyOf = (sessionId: string) => `moddeck:screen:${sessionId}`;

// Used when the browser refuses localStorage: this window still works, it only forgets on refresh.
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

function read(key: string): string | null {
  const held = memory.get(key);
  if (held !== undefined) return held;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parse(raw: string | null): Partial<ScreenLayers> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Partial<ScreenLayers>;
  } catch {
    return {};
  }
}

function write(key: string, next: Partial<ScreenLayers>) {
  const value = JSON.stringify({ ...parse(read(key)), ...next });
  try {
    window.localStorage.setItem(key, value);
  } catch {
    memory.set(key, value);
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/**
 * The screen layers, shared by every window of this session in the browser. The deck has no
 * separate lobby slide, so the room's first slide is the lobby: until the host decides, the join
 * screen shows there, and moving to another slide closes it for good. J opens it again.
 */
export function useScreenLayers(
  sessionId: string,
  slideId: string | null,
  onFirstSlide: boolean,
): [ScreenLayers, (next: Partial<ScreenLayers>) => void] {
  const key = keyOf(sessionId);
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  const stored = parse(raw);
  const layers: ScreenLayers = {
    blank: stored.blank ?? false,
    join: stored.join ?? onFirstSlide,
    joinBar: stored.joinBar ?? true,
  };

  const shownSlide = useRef(slideId);
  useEffect(() => {
    const previous = shownSlide.current;
    shownSlide.current = slideId;
    if (previous && slideId && previous !== slideId && parse(read(key)).join !== false) {
      write(key, { join: false });
    }
  }, [key, slideId]);

  const update = useCallback((next: Partial<ScreenLayers>) => write(key, next), [key]);
  return [layers, update];
}
