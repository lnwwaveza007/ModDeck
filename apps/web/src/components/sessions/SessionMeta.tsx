"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { SessionSummary } from "@moddeck/shared";

/** The date and start time of a session, as the host reads it in a list or a dialog. */
export function useSessionDate() {
  const format = useFormatter();
  return (session: SessionSummary) =>
    format.dateTime(new Date(session.startedAt), {
      dateStyle: "medium",
      timeStyle: "short",
    });
}

/** How long the session ran, in whole minutes. null while it is still open. */
export function useSessionDuration() {
  const t = useTranslations("history");
  return (session: SessionSummary) => {
    if (!session.endedAt) return null;
    const ms = Date.parse(session.endedAt) - Date.parse(session.startedAt);
    const total = Math.max(0, Math.round(ms / 60_000));
    if (total < 60) return t("minutes", { count: total });
    return t("hoursMinutes", { hours: Math.floor(total / 60), minutes: total % 60 });
  };
}

/** Date · duration · participants, one line under the deck title. */
export function SessionFacts({ session }: { session: SessionSummary }) {
  const t = useTranslations("history");
  const date = useSessionDate();
  const duration = useSessionDuration();
  const facts = [
    date(session),
    duration(session),
    t("participants", { count: session.participantCount }),
  ].filter((fact): fact is string => fact !== null);
  return (
    <p className="flex flex-wrap gap-x-2 text-sm text-muted">
      {facts.map((fact, i) => (
        <span key={i} className="flex gap-x-2">
          {i > 0 && <span aria-hidden="true">·</span>}
          <span className="tabular-nums">{fact}</span>
        </span>
      ))}
    </p>
  );
}
