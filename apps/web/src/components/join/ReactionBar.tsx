"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { REACTION_EMOJIS, REACTION_INTERVAL_MS, type ReactionEmoji } from "@moddeck/shared";
import { cn } from "@/lib/cn";
import { useCanSend } from "@/lib/realtime/live-status";

/** i18n key of each emoji's name, for screen readers. */
const EMOJI_NAMES = {
  "👏": "clap",
  "❤️": "heart",
  "😂": "laugh",
  "😮": "wow",
  "🎉": "party",
} as const satisfies Record<ReactionEmoji, string>;

const POP_MS = 1400;

/**
 * The five live reactions on the student screen (F11). A tap floats the emoji up on the
 * projector. The bar rests for REACTION_INTERVAL_MS after each tap, the same limit the server
 * keeps, so a tap that shows here is one the server counts. `react` returns false when the phone
 * is not in the room.
 */
export function ReactionBar({ react }: { react: (emoji: ReactionEmoji) => boolean }) {
  const t = useTranslations("live.reactions");
  const canSend = useCanSend();
  const [resting, setResting] = useState(false);
  const [pops, setPops] = useState<{ id: number; emoji: ReactionEmoji; left: number }[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
    };
  }, []);

  const later = (ms: number, run: () => void) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      run();
    }, ms);
    timers.current.add(timer);
  };

  const tap = (emoji: ReactionEmoji, index: number) => {
    if (resting || !canSend || !react(emoji)) return;
    setResting(true);
    later(REACTION_INTERVAL_MS, () => setResting(false));
    const id = nextId.current++;
    setPops((current) => [...current, { id, emoji, left: (index + 0.5) * 20 }]);
    later(POP_MS, () => setPops((current) => current.filter((pop) => pop.id !== id)));
  };

  return (
    <div className="relative border-t border-neutral-200 bg-background px-3 py-2">
      <div
        aria-hidden="true"
        className="reaction-area pointer-events-none absolute inset-x-0 bottom-full h-40 overflow-hidden"
      >
        {pops.map((pop) => (
          <span
            key={pop.id}
            className="reaction-rise absolute inset-y-0 flex w-10 items-end justify-center text-3xl"
            style={{ left: `calc(${pop.left}% - 1.25rem)`, animationDuration: `${POP_MS}ms` }}
          >
            {pop.emoji}
          </span>
        ))}
      </div>
      <div role="group" aria-label={t("label")} className="flex justify-between gap-1">
        {REACTION_EMOJIS.map((emoji, index) => (
          <button
            key={emoji}
            type="button"
            aria-label={t(EMOJI_NAMES[emoji])}
            // Resting is aria-disabled, not disabled: a disabled button would drop keyboard focus.
            disabled={!canSend}
            aria-disabled={resting || undefined}
            onClick={() => tap(emoji, index)}
            className={cn(
              "grid h-12 flex-1 place-items-center rounded-full text-2xl transition-[transform,opacity] focus-visible:outline-2 focus-visible:outline-ring motion-safe:active:scale-90",
              "hover:bg-neutral-100 disabled:opacity-40",
              resting && "opacity-40",
            )}
          >
            <span aria-hidden="true">{emoji}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
