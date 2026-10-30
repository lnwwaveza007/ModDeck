"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { DECK_TITLE_MAX, type DeckSummary } from "@moddeck/shared";
import { HostPage } from "@/components/shell/HostPage";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { LoadingState } from "@/components/states/LoadingState";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api/client";
import { createDeck, deleteDeck, duplicateDeck, listDecks, renameDeck } from "@/lib/api/decks";
import { DeckCard } from "./DeckCard";
import { DeckTitleDialog, DeleteDeckDialog } from "./DeckDialogs";

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; decks: DeckSummary[] };
type OpenDialog =
  | { kind: "create" }
  | { kind: "rename"; deck: DeckSummary }
  | { kind: "delete"; deck: DeckSummary };

// Newest edit first, like GET /decks.
const byUpdated = (decks: DeckSummary[]) =>
  [...decks].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

/** MD-15 H01 My decks: search, New deck, cards with rename / duplicate / delete. */
export function DeckList() {
  const t = useTranslations("decks");
  const tStates = useTranslations("states");
  const tPages = useTranslations("pages");
  const router = useRouter();
  const toast = useToast();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [now] = useState(() => new Date());
  // Bumped by "Try again" to load the list once more.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    listDecks().then(
      (decks) => {
        if (active) setLoad({ status: "ready", decks });
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

  const update = (change: (decks: DeckSummary[]) => DeckSummary[]) =>
    setLoad((current) =>
      current.status === "ready"
        ? { status: "ready", decks: byUpdated(change(current.decks)) }
        : current,
    );

  async function create(title: string) {
    const deck = await createDeck(title);
    update((decks) => [deck, ...decks]);
    router.push(`/decks/${deck.id}`);
  }

  async function rename(deckId: string, title: string) {
    const deck = await renameDeck(deckId, title);
    update((decks) => decks.map((d) => (d.id === deck.id ? deck : d)));
    setDialog(null);
    toast(t("toasts.renamed"), { tone: "success" });
  }

  async function duplicate(source: DeckSummary) {
    try {
      const title = t("copyTitle", { title: source.title }).slice(0, DECK_TITLE_MAX);
      const deck = await duplicateDeck(source.id, title);
      update((decks) => [deck, ...decks]);
      toast(t("toasts.duplicated"), { tone: "success" });
    } catch (error) {
      const notFound = error instanceof ApiError && error.code === "NOT_FOUND";
      toast(t(notFound ? "errors.NOT_FOUND" : "errors.generic"), { tone: "error" });
    }
  }

  async function remove(deckId: string) {
    await deleteDeck(deckId);
    update((decks) => decks.filter((d) => d.id !== deckId));
    setDialog(null);
    toast(t("toasts.deleted"), { tone: "success" });
  }

  const openCreate = () => setDialog({ kind: "create" });
  const newDeckButton = (
    <Button onClick={openCreate}>
      <PlusIcon />
      {t("newDeck")}
    </Button>
  );
  const hasDecks = load.status === "ready" && load.decks.length > 0;
  const needle = query.trim().toLocaleLowerCase();
  const shown =
    load.status === "ready"
      ? load.decks.filter((deck) => deck.title.toLocaleLowerCase().includes(needle))
      : [];

  return (
    <HostPage
      title={tPages("decks.title")}
      framed={false}
      actions={
        <>
          {hasDecks && <SearchField label={t("search")} value={query} onChange={setQuery} />}
          {newDeckButton}
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

      {load.status === "ready" && !hasDecks && (
        <EmptyState
          title={t("empty.title")}
          description={t("empty.description")}
          action={newDeckButton}
        />
      )}

      {hasDecks && shown.length === 0 && (
        <EmptyState
          title={t("noMatch.title", { query: query.trim() })}
          description={t("noMatch.description")}
        />
      )}

      {shown.length > 0 && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-5">
          {shown.map((deck) => (
            <li key={deck.id} className="flex flex-col">
              <DeckCard
                deck={deck}
                now={now}
                onRename={() => setDialog({ kind: "rename", deck })}
                onDuplicate={() => void duplicate(deck)}
                onDelete={() => setDialog({ kind: "delete", deck })}
              />
            </li>
          ))}
        </ul>
      )}

      {dialog?.kind === "create" && (
        <DeckTitleDialog mode="create" onSubmit={create} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "rename" && (
        <DeckTitleDialog
          mode="rename"
          initialTitle={dialog.deck.title}
          onSubmit={(title) => rename(dialog.deck.id, title)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteDeckDialog
          title={dialog.deck.title}
          onConfirm={() => remove(dialog.deck.id)}
          onClose={() => setDialog(null)}
        />
      )}
    </HostPage>
  );
}

function SearchField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="relative flex w-full items-center sm:w-65">
      <span aria-hidden="true" className="absolute left-3 flex text-muted">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
      </span>
      <input
        type="search"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-md border border-border bg-background pr-3 pl-9.5 text-base placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
      />
    </label>
  );
}

function PlusIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
