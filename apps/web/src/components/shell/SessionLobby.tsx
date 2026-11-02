"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import QRCode from "qrcode";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  getSession,
  requestSessionEnd,
  undoSessionEnd,
  finishSessionEnd,
  type SessionInfo,
} from "@/lib/api/sessions";

const HOLD_MS = 2000;
const FINISH_RETRY_MS = 1000;

export function SessionLobby({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const t = useTranslations("host");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState(false);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [qrData, setQrData] = useState("");
  const [qrFailed, setQrFailed] = useState(false);
  const holding = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadline = useRef<number | null>(null);
  // Server time minus browser time. Keeps the countdown right when the browser clock is off.
  const clockOffset = useRef(0);
  const finishing = useRef(false);
  const nextFinishAttempt = useRef(0);
  const holdHintId = useId();

  const refresh = useCallback(async () => {
    try {
      const value = await getSession(sessionId);
      if (value.serverNow !== undefined) clockOffset.current = value.serverNow - Date.now();
      setSession(value);
      if (value.status === "ended" && !value.endingAt) router.replace(`/sessions/${sessionId}`);
    } catch {
      setError(true);
    }
  }, [router, sessionId]);

  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const poll = setInterval(() => void refresh(), 2500);
    return () => {
      clearTimeout(initial);
      clearInterval(poll);
    };
  }, [refresh]);

  useEffect(() => {
    if (!session?.endingAt) {
      const reset = setTimeout(() => setSeconds(null), 0);
      return () => clearTimeout(reset);
    }
    deadline.current = session.endingAt;
    const tick = () => {
      const serverNow = Date.now() + clockOffset.current;
      const left = Math.max(0, Math.ceil(((deadline.current ?? 0) - serverNow) / 1000));
      setSeconds(left);
      // One finish request in flight at a time, and a pause before any retry.
      if (left === 0 && !finishing.current && Date.now() >= nextFinishAttempt.current) {
        finishing.current = true;
        nextFinishAttempt.current = Date.now() + FINISH_RETRY_MS;
        void finishSessionEnd(sessionId)
          // A rejected finish only means the server window is still open. refresh decides next.
          .catch(() => undefined)
          .then(() => refresh())
          .finally(() => {
            finishing.current = false;
          });
      }
    };
    const initial = setTimeout(tick, 0);
    const timer = setInterval(tick, 250);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [session?.endingAt, sessionId, refresh]);

  const startHold = () => {
    if (seconds !== null || holding.current) return;
    holding.current = true;
    holdTimer.current = setTimeout(async () => {
      holding.current = false;
      try {
        await requestSessionEnd(sessionId);
        await refresh();
      } catch {
        setError(true);
      }
    }, HOLD_MS);
  };
  const cancelHold = () => {
    holding.current = false;
    if (holdTimer.current) clearTimeout(holdTimer.current);
  };
  const onHoldKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
      event.preventDefault();
      startHold();
    }
  };
  const onHoldKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === " " || event.key === "Enter") cancelHold();
  };
  const undo = async () => {
    try {
      await undoSessionEnd(sessionId);
      await refresh();
    } catch {
      await refresh();
    }
  };

  useEffect(() => {
    if (!session?.joinUrl) return;
    let active = true;
    QRCode.toDataURL(session.joinUrl, { width: 240, margin: 2, errorCorrectionLevel: "M" })
      .then((url) => {
        if (active) setQrData(url);
      })
      .catch(() => {
        if (active) setQrFailed(true);
      });
    return () => {
      active = false;
    };
  }, [session?.joinUrl]);

  if (error)
    return (
      <main className="grid min-h-[70vh] place-items-center">
        <p>{t("lobby.loadError")}</p>
      </main>
    );
  if (!session)
    return (
      <main className="grid min-h-[70vh] place-items-center">
        <p>{t("lobby.loading")}</p>
      </main>
    );

  const pin = session.pin.replace(/(\d{3})(\d{3})/, "$1 $2");
  const joinHost = session.joinUrl.replace(/^https?:\/\//, "");

  return (
    <main className="min-h-[calc(100vh-64px)] bg-neutral-100 p-6 text-neutral-600">
      <header className="mx-auto flex max-w-6xl items-center justify-between rounded-xl bg-white px-6 py-4 shadow-sm">
        <div>
          <span className="mr-3 rounded-full bg-error-600 px-3 py-1 text-sm font-bold text-white">
            {t("live")}
          </span>
          <strong>{session.deck.title}</strong>
        </div>
        <div className="flex items-center gap-6">
          <span className="font-mono font-bold text-orange-700">PIN {pin}</span>
          <span>● {t("lobby.online", { count: session.participantCount })}</span>
        </div>
      </header>
      {seconds !== null ? (
        <section
          role="status"
          className="mx-auto mt-8 max-w-3xl rounded-2xl border border-neutral-300 bg-neutral-300 px-6 py-4 text-center"
        >
          <h1 className="text-2xl font-bold">{t("lobby.ending")}</h1>
          <p className="mt-2">{t("lobby.undoIn", { seconds })}</p>
          <button
            className="mt-5 rounded-lg border-2 border-success-800 bg-success-700 px-6 py-3 font-bold text-white shadow-md transition-colors hover:bg-success-800 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-success-700"
            onClick={() => void undo()}
          >
            {t("lobby.undo")}
          </button>
        </section>
      ) : (
        <section className="mx-auto mt-8 grid max-w-6xl gap-8 rounded-2xl bg-white p-8 shadow-sm md:grid-cols-[1fr_300px]">
          <div className="flex flex-col justify-center">
            <p className="text-lg">{t("lobby.joinAt", { url: joinHost })}</p>
            <p className="mt-5 text-sm text-neutral-500">{t("lobby.enterPin")}</p>
            <p className="font-mono text-7xl font-extrabold tracking-[0.12em] text-warning-600">
              {pin}
            </p>
            <p className="mt-8 text-lg">
              <span className="mr-2 text-success-600">●</span>
              {t("lobby.participantsJoined", { count: session.participantCount })}
            </p>
          </div>
          <div className="text-center">
            {qrData && (
              <img
                src={qrData}
                alt={t("lobby.qrAlt", { pin: session.pin })}
                className="mx-auto aspect-square w-60 rounded-xl border border-warning-500 p-2"
              />
            )}
            {!qrData && (
              <div className="mx-auto grid aspect-square w-60 place-items-center rounded-xl border border-warning-500">
                {qrFailed ? t("lobby.qrFailed") : t("lobby.qrCreating")}
              </div>
            )}
            <p className="mt-3 text-sm text-neutral-500">{t("lobby.scanToJoin")}</p>
          </div>
        </section>
      )}
      <div className="mx-auto mt-8 max-w-6xl text-right">
        {seconds === null && (
          <>
            <button
              aria-describedby={holdHintId}
              onPointerDown={startHold}
              onPointerUp={cancelHold}
              onPointerLeave={cancelHold}
              onPointerCancel={cancelHold}
              onKeyDown={onHoldKeyDown}
              onKeyUp={onHoldKeyUp}
              onBlur={cancelHold}
              className="touch-none rounded-lg border-2 border-error-600 px-6 py-3 font-semibold text-error-600 transition-colors hover:bg-error-700 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-error-600 active:bg-error-800"
            >
              {t("lobby.endSession")}
            </button>
            <p id={holdHintId} className="mt-2 text-sm text-neutral-500">
              {t("lobby.holdHint")}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
