"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { ActivityResult, LiveQuestion, SessionResults } from "@moddeck/shared";
import { RichText } from "@/components/content/RichText";
import { PollChart } from "@/components/poll/PollChart";
import { HostPage } from "@/components/shell/HostPage";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { LoadingState } from "@/components/states/LoadingState";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClass } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { WordCloud } from "@/components/wordcloud/WordCloud";
import { ApiError } from "@/lib/api/client";
import { deleteSession, getSessionResults } from "@/lib/api/sessions";
import { cn } from "@/lib/cn";
import { groupQuestions } from "@/lib/live/questions";
import { DeleteSessionDialog } from "./DeleteSessionDialog";
import { SessionFacts } from "./SessionMeta";

type Load =
  | { status: "loading" }
  | { status: "error" }
  | { status: "not_found" }
  | { status: "live" }
  | { status: "ready"; results: SessionResults };

/**
 * Results of one ended session (F10): a card per activity in slide order, then the Q&A list.
 * The numbers are the ones the room saw: removed participants and hidden words are left out.
 */
export function SessionResultsView({ sessionId }: { sessionId: string }) {
  const t = useTranslations("history");
  const tStates = useTranslations("states");
  const tPages = useTranslations("pages");
  const router = useRouter();
  const toast = useToast();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [deleting, setDeleting] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    getSessionResults(sessionId).then(
      (results) => {
        if (active) setLoad({ status: "ready", results });
      },
      (error) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) router.replace("/login");
        else if (error instanceof ApiError && error.code === "NOT_FOUND")
          setLoad({ status: "not_found" });
        else if (error instanceof ApiError && error.code === "SESSION_LIVE")
          setLoad({ status: "live" });
        else setLoad({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt, router, sessionId]);

  async function remove() {
    await deleteSession(sessionId);
    toast(t("toasts.deleted"), { tone: "success" });
    router.replace("/sessions");
  }

  const ready = load.status === "ready" ? load.results : null;
  const back = (
    <Link href="/sessions" className={buttonClass({ variant: "secondary" })}>
      {t("results.back")}
    </Link>
  );

  return (
    <HostPage
      title={ready?.session.deck.title ?? tPages("sessionResults.title")}
      framed={false}
      actions={
        <>
          {back}
          {ready && (
            <Button variant="danger" onClick={() => setDeleting(true)}>
              {t("delete")}
            </Button>
          )}
        </>
      }
    >
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

      {load.status === "not_found" && (
        <EmptyState
          title={t("results.notFound.title")}
          description={t("results.notFound.description")}
        />
      )}

      {load.status === "live" && (
        <EmptyState
          title={t("results.live.title")}
          description={t("results.live.description")}
          action={
            <Link href={`/host/${sessionId}`} className={buttonClass()}>
              {t("openPresenter")}
            </Link>
          }
        />
      )}

      {ready && (
        <>
          <div className="-mt-4 flex flex-wrap items-center gap-2">
            {ready.session.deck.deleted && <Badge>{t("deckDeleted")}</Badge>}
            <SessionFacts session={ready.session} />
          </div>

          {ready.activities.length === 0 ? (
            <p className="text-muted">{t("results.noActivities")}</p>
          ) : (
            <ul className="grid gap-5 lg:grid-cols-2">
              {ready.activities.map((result) => (
                <li key={result.activity.id} className="flex flex-col">
                  <ActivityCard result={result} />
                </li>
              ))}
            </ul>
          )}

          <QaCard shown={ready.qaShown} questions={ready.questions} />
        </>
      )}

      {ready && deleting && (
        <DeleteSessionDialog
          session={ready.session}
          onConfirm={remove}
          onClose={() => setDeleting(false)}
        />
      )}
    </HostPage>
  );
}

function ActivityCard({ result }: { result: ActivityResult }) {
  const t = useTranslations("history.results");
  const { activity, ran, results, cloud } = result;
  const kind = activity.type === "poll" ? t("poll") : t("wordCloud");

  return (
    <Card className={cn("flex flex-1 flex-col gap-4", !ran && "bg-neutral-50 shadow-none")}>
      <header className="flex flex-col gap-1">
        <p className="text-xs font-semibold tracking-wide text-muted uppercase">
          {t("slide", { number: result.slidePosition + 1 })} · {kind}
        </p>
        <h2 className="font-bold">
          <RichText source={activity.prompt} />
        </h2>
      </header>

      {!ran && <p className="text-sm text-muted">{t("notRun")}</p>}

      {results && (
        <>
          <PollChart options={activity.options} tally={results} scale="panel" />
          <p className="text-sm text-muted">
            {results.answered === 0 ? t("noAnswers") : t("answers", { count: results.answered })}
          </p>
        </>
      )}

      {cloud && (
        <>
          {cloud.words.length > 0 && <WordCloud words={cloud.words} scale="panel" />}
          <p className="text-sm text-muted">
            {cloud.entries === 0 ? t("noWords") : t("entries", { count: cloud.entries })}
            {cloud.entries > 0 && <> · {t("hiddenNote")}</>}
          </p>
        </>
      )}
    </Card>
  );
}

function QaCard({ shown, questions }: { shown: boolean; questions: LiveQuestion[] }) {
  const t = useTranslations("history.results.qa");
  const { pinned, open, answered, hidden } = groupQuestions(questions);
  // After class a pin means nothing more than "not answered yet": it joins that list on top.
  const sections = [
    { key: "open", items: pinned ? [pinned, ...open] : open },
    { key: "answered", items: answered },
    { key: "hidden", items: hidden },
  ] as const;

  return (
    <Card className="flex flex-col gap-4">
      <header className="flex items-baseline gap-2">
        <h2 className="text-lg font-bold">{t("title")}</h2>
        {questions.length > 0 && (
          <span className="text-sm text-muted">{t("count", { count: questions.length })}</span>
        )}
      </header>

      {questions.length === 0 && (
        <p className="text-sm text-muted">{shown ? t("empty") : t("off")}</p>
      )}

      {sections.map(
        ({ key, items }) =>
          items.length > 0 && (
            <section key={key} aria-label={t(key)} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">
                {t(key)} <span className="font-normal text-muted">({items.length})</span>
              </h3>
              <ul className="flex flex-col gap-2">
                {items.map((question) => (
                  <li
                    key={question.id}
                    className={cn(
                      "flex flex-col gap-1.5 rounded-md border border-neutral-200 p-3",
                      key === "hidden" && "bg-neutral-50 text-muted",
                    )}
                  >
                    <RichText source={question.text} className="text-sm wrap-break-word" />
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                      <span className="font-semibold text-foreground tabular-nums">
                        ▲ {t("votes", { count: question.votes })}
                      </span>
                      <span aria-hidden="true">·</span>
                      {/* Anonymous questions come without a name, so none can show here. */}
                      <span>{question.anonymous ? t("anonymous") : question.author}</span>
                      {key === "answered" && <Badge tone="success">{t("answered")}</Badge>}
                      {key === "hidden" && <Badge>{t("hidden")}</Badge>}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ),
      )}
    </Card>
  );
}
