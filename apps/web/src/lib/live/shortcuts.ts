"use client";

// Keyboard shortcuts of presenter control and the audience screen. With one display the host
// runs the whole lecture from the audience screen with these keys and the O overlay.

import { useEffect, useRef } from "react";

export type ShortcutCommand =
  | "next"
  | "previous"
  | "first"
  | "last"
  | "toggleActivity" // start, stop or reopen the activity on screen
  | "showResults"
  | "liveChart" // the chart on the audience screen while voting is open
  | "overlay"
  | "blank"
  | "join" // join info with the QR code on the audience screen
  | "joinBar" // the small PIN bar in the corner of the audience screen
  | "fullscreen"
  | "help";

/** Shown in the help panel, in this order. Keys are display labels, not event.key values. */
export const SHORTCUT_LIST: { command: ShortcutCommand; keys: string[] }[] = [
  { command: "next", keys: ["→", "Space"] },
  { command: "previous", keys: ["←"] },
  { command: "first", keys: ["Home"] },
  { command: "last", keys: ["End"] },
  { command: "toggleActivity", keys: ["A"] },
  { command: "showResults", keys: ["S"] },
  { command: "liveChart", keys: ["L"] },
  { command: "overlay", keys: ["O"] },
  { command: "blank", keys: ["B"] },
  { command: "join", keys: ["J"] },
  { command: "joinBar", keys: ["H"] },
  { command: "fullscreen", keys: ["F"] },
  { command: "help", keys: ["?"] },
];

type KeyLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"> & {
  target: EventTarget | null;
};

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest("[role='dialog']")) return true; // a dialog owns its keys
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** The command for a key press, or null. Never fires while the host is typing. */
export function shortcutFor(event: KeyLike): ShortcutCommand | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (isTyping(event.target)) return null;
  // Space on a focused button presses the button; it does not move the slide.
  if (event.key === " " && event.target instanceof HTMLButtonElement) return null;
  switch (event.key) {
    case "ArrowRight":
    case "PageDown":
      return "next";
    case " ":
      return event.shiftKey ? "previous" : "next";
    case "ArrowLeft":
    case "PageUp":
      return "previous";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "?":
      return "help";
  }
  switch (event.key.toLowerCase()) {
    case "a":
      return "toggleActivity";
    case "s":
      return "showResults";
    case "l":
      return "liveChart";
    case "o":
      return "overlay";
    case "b":
      return "blank";
    case "j":
      return "join";
    case "h":
      return "joinBar";
    case "f":
      return "fullscreen";
  }
  return null;
}

/** Calls `handle` for each shortcut pressed on the page. Return false to let the key through. */
export function useShortcuts(handle: (command: ShortcutCommand) => boolean | void) {
  const handleRef = useRef(handle);
  useEffect(() => {
    handleRef.current = handle;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat && event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      const command = shortcutFor(event);
      if (!command) return;
      if (handleRef.current(command) === false) return;
      event.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
