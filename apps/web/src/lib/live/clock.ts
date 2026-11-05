"use client";

import { useEffect, useState } from "react";

/** Server time now, ms. Ticks every `everyMs` so countdowns and the session clock move. */
export function useServerNow(clockOffset: number, everyMs = 250): number {
  const [now, setNow] = useState(() => Date.now() + clockOffset);
  useEffect(() => {
    const tick = () => setNow(Date.now() + clockOffset);
    const initial = setTimeout(tick, 0);
    const timer = setInterval(tick, everyMs);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [clockOffset, everyMs]);
  return now;
}

/** Whole seconds left until `endsAt`, never below zero. */
export function secondsLeft(endsAt: number, now: number): number {
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = String(s % 60).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}
