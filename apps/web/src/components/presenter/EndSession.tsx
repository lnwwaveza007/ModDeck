"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { endSession, getSession, type SessionInfo } from "@/lib/api/sessions";

const HOLD_MS = 2000;
const POLL_MS = 2500;

export interface SessionEndState {
  session: SessionInfo | null;
  /** True from the end request until the results page opens. */
  ending: boolean;
  /** Ends the session and opens its results page. Rejects when the request fails. */
  end: () => Promise<void>;
}

/**
 * Session status for presenter control: the participant count, and ending the session. Ending
 * is immediate: the 2 s hold on the button is the guard. A session ended from another window
 * opens the results page here too.
 */
export function useSessionEnd(sessionId: string): SessionEndState {
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [ending, setEnding] = useState(false);
  const results = `/sessions/${sessionId}`;

  const refresh = useCallback(async () => {
    try {
      const value = await getSession(sessionId);
      setSession(value);
      if (value.status === "ended") router.replace(results);
    } catch {
      // The live view shows load errors; a failed poll just waits for the next one.
    }
  }, [results, router, sessionId]);

  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const poll = setInterval(() => void refresh(), POLL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(poll);
    };
  }, [refresh]);

  const end = useCallback(async () => {
    setEnding(true);
    try {
      await endSession(sessionId);
    } catch (error) {
      setEnding(false);
      throw error;
    }
    router.replace(results);
  }, [results, router, sessionId]);

  return { session, ending, end };
}

/** Hold for 2 s to end. The end is immediate, so the hold is the guard against a slip. */
export function EndSessionButton({
  onEnd,
  ending = false,
}: {
  onEnd: () => void;
  ending?: boolean;
}) {
  const t = useTranslations("host.lobby");
  const holding = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Drives the fill that shows how long is left to hold. A plain click must not look broken.
  const [held, setHeld] = useState(false);
  const hintId = useId();

  const startHold = () => {
    if (holding.current || ending) return;
    holding.current = true;
    setHeld(true);
    holdTimer.current = setTimeout(() => {
      holding.current = false;
      setHeld(false);
      onEnd();
    }, HOLD_MS);
  };
  const cancelHold = () => {
    holding.current = false;
    setHeld(false);
    if (holdTimer.current) clearTimeout(holdTimer.current);
  };
  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    [],
  );
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
      event.preventDefault();
      startHold();
    }
  };
  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === " " || event.key === "Enter") cancelHold();
  };

  return (
    <>
      <button
        type="button"
        disabled={ending}
        aria-describedby={hintId}
        title={t("holdHint")}
        onPointerDown={startHold}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={cancelHold}
        aria-label={t("endSession")}
        className="relative h-11 touch-none overflow-hidden rounded-lg border-2 border-error-600 px-4 text-sm font-semibold text-error-600 hover:bg-error-50 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-error-600"
      >
        <span
          aria-hidden="true"
          data-testid="end-hold-fill"
          className="absolute inset-y-0 left-0 bg-error-100 ease-linear"
          style={{
            width: held ? "100%" : "0%",
            transitionProperty: "width",
            transitionDuration: held ? `${HOLD_MS}ms` : "150ms",
          }}
        />
        <span className="relative">
          {ending ? t("endingNow") : held ? t("keepHolding") : t("endSession")}
        </span>
      </button>
      <span id={hintId} className="sr-only">
        {t("holdHint")}
      </span>
    </>
  );
}
