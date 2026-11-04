"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { ParticipantMe } from "@moddeck/shared";
import { LiveShell } from "@/components/shell/LiveShell";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";
import { buttonClass } from "@/components/ui/Button";
import { ApiError } from "@/lib/api/client";
import { getParticipantMe } from "@/lib/api/participants";
import { LiveConnection, type ConnectionStatus } from "@/lib/realtime/live-connection";

type Stop = "notJoined" | "removed" | "ended" | "network";

function stopFor(error: unknown): Stop {
  if (!(error instanceof ApiError)) return "network";
  if (error.code === "PARTICIPANT_REMOVED") return "removed";
  if (error.code === "SESSION_ENDED") return "ended";
  if (error.status === 401) return "notJoined";
  return "network";
}

/**
 * Student live screen (MD-15 S06). A late joiner starts from the slide the class is
 * on now: /participants/me gives it, then the socket keeps it current. Live polls
 * and word clouds plug in here when they are built.
 */
export function LiveSession({ sessionId }: { sessionId: string }) {
  const t = useTranslations("live");
  const [me, setMe] = useState<ParticipantMe | null>(null);
  const [stop, setStop] = useState<Stop | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [slideIndex, setSlideIndex] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    let connection: LiveConnection | undefined;
    // Re-reads where the class is, for a snapshot after a (re)join.
    const refresh = () =>
      getParticipantMe().then(
        (value) => active && setSlideIndex(value.currentSlide?.index ?? null),
        () => undefined,
      );

    getParticipantMe().then(
      (value) => {
        if (!active) return;
        // The cookie belongs to another session: this browser has not joined this one.
        if (value.sessionId !== sessionId) return setStop("notJoined");
        setMe(value);
        setSlideIndex(value.currentSlide?.index ?? null);
        connection = new LiveConnection({
          sessionId,
          onStatus: (next) => {
            setStatus(next);
            if (next === "ended") setStop("ended");
          },
          onSnapshot: () => void refresh(),
          onEvent: (event) => {
            if (event.type === "slide_changed") setSlideIndex(event.data.index);
            if (event.type === "session_ended") setStop("ended");
          },
          onError: (error) => {
            if (error.code === "PARTICIPANT_REMOVED") setStop("removed");
            if (error.code === "SESSION_ENDED") setStop("ended");
          },
        });
        connection.connect();
      },
      (error: unknown) => {
        if (active) setStop(stopFor(error));
      },
    );
    return () => {
      active = false;
      connection?.close();
    };
  }, [sessionId]);

  if (stop) return <Stopped reason={stop} />;
  if (!me) {
    return (
      <p role="status" className="m-auto text-muted">
        {t("connecting")}
      </p>
    );
  }

  const statusText =
    status === "online"
      ? t("connectedAs", { name: me.nickname })
      : status === "connecting"
        ? t("connecting")
        : t(status === "offline" ? "offline" : "reconnecting");

  return (
    <LiveShell
      title={me.title}
      status={statusText}
      activity={
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-xl font-semibold">{t("lookAtScreen")}</p>
          <p className="text-muted">
            {slideIndex === null
              ? t("startingSoon")
              : t("slideOf", { index: slideIndex + 1, total: me.slideCount })}
          </p>
        </div>
      }
      qa={<PagePlaceholder page="live" titled={false} />}
    />
  );
}

function Stopped({ reason }: { reason: Stop }) {
  const t = useTranslations("live");
  return (
    <section className="flex flex-1 flex-col justify-center gap-6 px-5 pb-10">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-bold">{t(`stopped.${reason}.title`)}</h1>
        <p className="text-neutral-700">{t(`stopped.${reason}.body`)}</p>
      </div>
      <Link href="/" className={buttonClass({ size: "lg", fullWidth: true })}>
        {t("enterPin")}
      </Link>
    </section>
  );
}
