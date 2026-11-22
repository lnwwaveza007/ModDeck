"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { SessionSummary } from "@moddeck/shared";
import { HostPage } from "@/components/shell/HostPage";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { LoadingState } from "@/components/states/LoadingState";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClass } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api/client";
import { deleteSession, listSessions } from "@/lib/api/sessions";
import { cn } from "@/lib/cn";
import { DeleteSessionDialog } from "./DeleteSessionDialog";
import { SessionFacts, useSessionDate } from "./SessionMeta";

type Load =
  { status: "loading" } | { status: "error" } | { status: "ready"; sessions: SessionSummary[] };

/**
 * Session history (F10): every session of the host's decks, newest first. An ended session opens
 * its results; a live one goes back to presenter control and cannot be deleted.
 */
export function SessionList() {
  const t = useTranslations("history");
  const tStates = useTranslations("states");
  const tPages = useTranslations("pages");
  const router = useRouter();
  const toast = useToast();
  const date = useSessionDate();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [deleting, setDeleting] = useState<SessionSummary | null>(null);
  // Bumped by "Try again" to load the list once more.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    listSessions().then(
      (sessions) => {
        if (active) setLoad({ status: "ready", sessions });
      },
      (error) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) router.replace("/login");
        else setLoad({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt, router]);

  async function remove(sessionId: string) {
    await deleteSession(sessionId);
    setLoad((current) =>
      current.status === "ready"
        ? { status: "ready", sessions: current.sessions.filter((s) => s.id !== sessionId) }
        : current,
    );
    setDeleting(null);
    toast(t("toasts.deleted"), { tone: "success" });
  }

  return (
    <HostPage title={tPages("sessions.title")} framed={false}>
      {load.status === "loading" && <LoadingState label={tStates("loading")} />}

      {load.status === "error" && (
        <ErrorState
          title={tStates("errorTitle")}
          description={tStates("errorDescription")}
          actions={
            <Button
              onClick={() => {
                setLoad({ status: "loading" });
                setAttempt((n) => n + 1);
              }}
            >
              {tStates("retry")}
            </Button>
          }
        />
      )}

      {load.status === "ready" && load.sessions.length === 0 && (
        <EmptyState
          title={t("empty.title")}
          description={t("empty.description")}
          action={
            <Link href="/decks" className={buttonClass()}>
              {tPages("decks.title")}
            </Link>
          }
        />
      )}

      {load.status === "ready" && load.sessions.length > 0 && (
        <ul className="flex flex-col gap-3">
          {load.sessions.map((session) => {
            const open = session.status !== "ended";
            return (
              <li
                key={session.id}
                className={cn(
                  "flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-neutral-200 bg-background px-5 py-4",
                  open && "ring-2 ring-error-600",
                )}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate font-bold">{session.deck.title}</h2>
                    {open && <Badge tone="error">{t("live")}</Badge>}
                    {session.deck.deleted && <Badge>{t("deckDeleted")}</Badge>}
                  </div>
                  <SessionFacts session={session} />
                </div>
                <div className="flex gap-2">
                  {open ? (
                    <Link href={`/host/${session.id}`} className={buttonClass()}>
                      {t("openPresenter")}
                    </Link>
                  ) : (
                    <>
                      <Link
                        href={`/sessions/${session.id}`}
                        className={buttonClass({ variant: "secondary" })}
                      >
                        {t("viewResults")}
                      </Link>
                      <Button
                        variant="ghost"
                        aria-label={t("deleteLabel", {
                          title: session.deck.title,
                          date: date(session),
                        })}
                        onClick={() => setDeleting(session)}
                      >
                        {t("delete")}
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {deleting && (
        <DeleteSessionDialog
          session={deleting}
          onConfirm={() => remove(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
    </HostPage>
  );
}
