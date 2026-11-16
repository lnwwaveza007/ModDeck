"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  REACTION_BATCH_MS,
  REACTION_EMOJIS,
  REACTION_MAX_ON_SCREEN,
  type ReactionBurst,
  type ReactionEmoji,
} from "@moddeck/shared";
import { cn } from "@/lib/cn";

/** How long one emoji takes to float up the stage, ms. */
export const REACTION_FLOAT_MS = 3200;

interface Floating {
  id: number;
  emoji: ReactionEmoji;
  /** Left edge, % of the stage width. */
  left: number;
  delayMs: number;
  durationMs: number;
  /** Side-to-side drift, cqw. */
  sway: number;
}

/**
 * Splits a burst into at most `room` emojis to draw, each emoji's share in proportion to its
 * taps, so a burst of 300 claps and 3 hearts still shows a heart.
 */
export function pickReactions(counts: ReactionBurst["counts"], room: number): ReactionEmoji[] {
  const entries = REACTION_EMOJIS.map((emoji) => [emoji, counts[emoji] ?? 0] as const).filter(
    ([, count]) => count > 0,
  );
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  if (room <= 0 || total === 0) return [];
  if (total <= room) return entries.flatMap(([emoji, count]) => Array(count).fill(emoji));
  const picked = entries.flatMap(([emoji, count]) =>
    Array(Math.max(1, Math.floor((count / total) * room))).fill(emoji),
  );
  return picked.slice(0, room);
}

/**
 * Live reactions floating up the right side of a stage (F11). Draws over its positioned parent,
 * at most REACTION_MAX_ON_SCREEN at a time. Decorative only: hidden from screen readers.
 */
export function ReactionLayer({
  subscribe,
  className,
}: {
  subscribe: (listener: (burst: ReactionBurst) => void) => () => void;
  className?: string;
}) {
  const [items, setItems] = useState<Floating[]>([]);
  const nextId = useRef(0);
  const onScreen = useRef(0);

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const unsubscribe = subscribe((burst) => {
      const emojis = pickReactions(burst.counts, REACTION_MAX_ON_SCREEN - onScreen.current);
      if (emojis.length === 0) return;
      const spawned = emojis.map((emoji): Floating => ({
        id: nextId.current++,
        emoji,
        left: 78 + Math.random() * 17,
        // Spread over the batch, so a burst rises as a stream rather than a block.
        delayMs: Math.random() * REACTION_BATCH_MS,
        durationMs: REACTION_FLOAT_MS * (0.85 + Math.random() * 0.3),
        sway: (Math.random() - 0.5) * 4,
      }));
      onScreen.current += spawned.length;
      setItems((current) => [...current, ...spawned]);
      const ids = new Set(spawned.map((item) => item.id));
      const last = Math.max(...spawned.map((item) => item.delayMs + item.durationMs));
      const timer = setTimeout(() => {
        timers.delete(timer);
        onScreen.current -= ids.size;
        setItems((current) => current.filter((item) => !ids.has(item.id)));
      }, last);
      timers.add(timer);
    });
    return () => {
      unsubscribe();
      for (const timer of timers) clearTimeout(timer);
      onScreen.current = 0;
    };
  }, [subscribe]);

  return (
    <div
      aria-hidden="true"
      data-testid="reaction-layer"
      className={cn(
        "reaction-area pointer-events-none absolute inset-0 @container overflow-hidden",
        className,
      )}
    >
      {items.map((item) => (
        <span
          key={item.id}
          className="reaction-rise absolute inset-y-0 flex w-[6cqw] items-end justify-center"
          style={
            {
              left: `${item.left}%`,
              animationDelay: `${item.delayMs}ms`,
              animationDuration: `${item.durationMs}ms`,
              "--reaction-sway": `${item.sway}cqw`,
            } as CSSProperties
          }
        >
          <span
            className="reaction-sway text-[4.5cqw] leading-none drop-shadow-md"
            style={{ animationDuration: `${item.durationMs / 2}ms` }}
          >
            {item.emoji}
          </span>
        </span>
      ))}
    </div>
  );
}
