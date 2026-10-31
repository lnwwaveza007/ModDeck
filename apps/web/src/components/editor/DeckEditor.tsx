"use client";

import { arrayMove } from "@dnd-kit/sortable";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SlideDto, SlideKind, SlidePatchBody } from "@moddeck/shared";
import { SlideRenderer } from "@/components/content/SlideRenderer";
import { SessionHeader } from "@/components/shell/SessionHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { LoadingState } from "@/components/states/LoadingState";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api/client";
import {
  createSlide,
  deleteSlide,
  duplicateSlide,
  getDeck,
  patchSlide,
  reorderSlides,
  uploadSlideImage,
} from "@/lib/api/slides";
import { SaveQueue } from "@/lib/editor/save-queue";
import { AddSlideDialog } from "./AddSlideDialog";
import { SaveIndicator } from "./SaveIndicator";
import { SlideList } from "./SlideList";
import { SlidePanel } from "./SlidePanel";

type Load =
  { status: "loading" } | { status: "error" } | { status: "notFound" } | { status: "ready" };

type OpenDialog =
  | { kind: "add" }
  | { kind: "delete"; slideId: string; pending: boolean; error?: "ACTIVITY_LOCKED" | "generic" };

/**
 * MD-15 H02 deck editor (F8): slide list on the left, the slide on a canvas in the middle, its
 * fields on the right. Text, code, math and image slides plus activity slots; every change
 * autosaves (technical design §3.3).
 */
export function DeckEditor({ deckId }: { deckId: string }) {
  const t = useTranslations("editor");
  const tPages = useTranslations("pages");
  const tStates = useTranslations("states");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const toast = useToast();

  const [queue] = useState(() => new SaveQueue());
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [title, setTitle] = useState("");
  const [slides, setSlides] = useState<SlideDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  // Bumped by "Try again" to load the deck once more.
  const [attempt, setAttempt] = useState(0);

  const selectedIndex = slides.findIndex((slide) => slide.id === selectedId);
  const selected = selectedIndex === -1 ? undefined : slides[selectedIndex];

  const apply = useCallback((deck: { title: string; slides: SlideDto[] }) => {
    setTitle(deck.title);
    setSlides(deck.slides);
    setSelectedId((current) =>
      deck.slides.some((slide) => slide.id === current) ? current : (deck.slides[0]?.id ?? null),
    );
    setLoad({ status: "ready" });
  }, []);

  const handleLoadError = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) router.replace("/login");
      else if (error instanceof ApiError && error.status === 404) setLoad({ status: "notFound" });
      else setLoad({ status: "error" });
    },
    [router],
  );

  useEffect(() => {
    let active = true;
    getDeck(deckId).then(
      (deck) => active && apply(deck),
      (error) => active && handleLoadError(error),
    );
    return () => {
      active = false;
    };
  }, [deckId, attempt, apply, handleLoadError]);

  // Edits still waiting go out when the host leaves or hides the tab.
  useEffect(() => {
    const flush = () => void queue.flush();
    const onVisibility = () => document.visibilityState === "hidden" && flush();
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (queue.status !== "saved") event.preventDefault();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", onBeforeUnload);
      queue.dispose();
    };
  }, [queue]);

  /** After a request the editor could not finish: say why, then show what the server has. */
  const recover = useCallback(
    (error: unknown) => {
      const locked = error instanceof ApiError && error.code === "ACTIVITY_LOCKED";
      toast(t(locked ? "errors.ACTIVITY_LOCKED" : "errors.generic"), { tone: "error" });
      getDeck(deckId).then(apply, handleLoadError);
    },
    [apply, deckId, handleLoadError, t, toast],
  );

  // A content change shows at once and goes to the server after a short pause.
  const edit = useCallback(
    (slideId: string, fields: SlidePatchBody) => {
      setSlides((current) =>
        current.map((slide) => (slide.id === slideId ? { ...slide, ...fields } : slide)),
      );
      queue.patch(slideId, fields, (body) => patchSlide(deckId, slideId, body));
    },
    [deckId, queue],
  );

  const insert = useCallback((slide: SlideDto) => {
    setSlides((current) => {
      const next = [...current];
      next.splice(slide.position, 0, slide);
      return next;
    });
    setSelectedId(slide.id);
  }, []);

  function addSlide(kind: SlideKind) {
    setDialog(null);
    const position = selectedIndex === -1 ? slides.length : selectedIndex + 1;
    queue
      .run(() => createSlide(deckId, { kind, position }))
      .then((slide) => {
        insert(slide);
        toast(t("toasts.added"), { tone: "success" });
      }, recover);
  }

  function duplicate() {
    if (!selected) return;
    queue
      .run(() => duplicateSlide(deckId, selected.id))
      .then((slide) => {
        insert(slide);
        toast(t("toasts.duplicated"), { tone: "success" });
      }, recover);
  }

  function reorder(slideIds: string[]) {
    setSlides((current) => {
      const byId = new Map(current.map((slide) => [slide.id, slide]));
      return slideIds.map((id, position) => ({ ...byId.get(id)!, position }));
    });
    queue.run(() => reorderSlides(deckId, slideIds)).catch(recover);
  }

  function move(delta: -1 | 1) {
    const to = selectedIndex + delta;
    if (selectedIndex === -1 || to < 0 || to >= slides.length) return;
    reorder(
      arrayMove(
        slides.map((slide) => slide.id),
        selectedIndex,
        to,
      ),
    );
  }

  async function confirmDelete(slideId: string) {
    setDialog({ kind: "delete", slideId, pending: true });
    try {
      await queue.run(() => deleteSlide(deckId, slideId));
    } catch (error) {
      if (error instanceof ApiError && error.code === "ACTIVITY_LOCKED") {
        setDialog({ kind: "delete", slideId, pending: false, error: "ACTIVITY_LOCKED" });
      } else {
        setDialog(null);
        recover(error);
      }
      return;
    }
    const index = slides.findIndex((slide) => slide.id === slideId);
    const rest = slides.filter((slide) => slide.id !== slideId);
    setSlides(rest.map((slide, position) => ({ ...slide, position })));
    setSelectedId((current) =>
      current === slideId ? (rest[index]?.id ?? rest[index - 1]?.id ?? null) : current,
    );
    setDialog(null);
    toast(t("toasts.deleted"), { tone: "success" });
  }

  async function uploadImage(slideId: string, file: File) {
    const updated = await queue.run(() => uploadSlideImage(deckId, slideId, file));
    setSlides((current) =>
      current.map((slide) =>
        slide.id === slideId ? { ...slide, imageRef: updated.imageRef } : slide,
      ),
    );
  }

  const header = (
    <SessionHeader leading="back" title={title || tPages("deckEditor.title")}>
      {load.status === "ready" && <SaveIndicator queue={queue} />}
    </SessionHeader>
  );

  const message = useMemo(() => {
    if (load.status === "loading") return <LoadingState label={tStates("loading")} />;
    if (load.status === "notFound") {
      return (
        <ErrorState
          title={tStates("notFoundTitle")}
          description={t("notFound")}
          actions={<Button onClick={() => router.push("/decks")}>{tCommon("backHome")}</Button>}
        />
      );
    }
    if (load.status === "error") {
      return (
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
      );
    }
    return null;
  }, [load.status, router, t, tCommon, tStates]);

  if (message) {
    return (
      <>
        {header}
        {message}
      </>
    );
  }

  const addButton = (
    <Button variant="secondary" fullWidth onClick={() => setDialog({ kind: "add" })}>
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
      {t("add.button")}
    </Button>
  );

  return (
    <>
      {header}
      <div className="flex flex-1 flex-wrap items-stretch">
        <nav
          aria-label={tPages("deckEditor.title")}
          className="flex flex-[0_0_200px] flex-col gap-3 border-r border-neutral-200 bg-background px-2 py-3"
        >
          <SlideList
            slides={slides}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onReorder={reorder}
          />
          {addButton}
        </nav>

        <main className="flex min-w-0 flex-[999_1_480px] flex-col gap-4 p-6">
          {selected ? (
            <>
              <div
                role="toolbar"
                aria-label={t("toolbar.label")}
                className="flex flex-wrap items-center gap-2"
              >
                <p className="mr-auto text-sm text-muted">
                  {t("toolbar.counter", { current: selectedIndex + 1, total: slides.length })}
                </p>
                <Button variant="ghost" disabled={selectedIndex === 0} onClick={() => move(-1)}>
                  {t("toolbar.moveUp")}
                </Button>
                <Button
                  variant="ghost"
                  disabled={selectedIndex === slides.length - 1}
                  onClick={() => move(1)}
                >
                  {t("toolbar.moveDown")}
                </Button>
                <Button variant="secondary" onClick={duplicate}>
                  {t("toolbar.duplicate")}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    setDialog({ kind: "delete", slideId: selected.id, pending: false })
                  }
                >
                  {t("toolbar.delete")}
                </Button>
              </div>
              <div className="mx-auto w-full max-w-240">
                <SlideRenderer slide={selected} className="shadow-sm" />
              </div>
            </>
          ) : (
            <EmptyState
              title={t("empty.title")}
              description={t("empty.description")}
              action={addButton}
            />
          )}
        </main>

        {selected && (
          <aside className="flex-[1_1_280px] border-l border-neutral-200 bg-background p-4 lg:max-w-90">
            <SlidePanel
              key={selected.id}
              slide={selected}
              onEdit={(fields) => edit(selected.id, fields)}
              onUploadImage={(file) => uploadImage(selected.id, file)}
            />
          </aside>
        )}
      </div>

      {dialog?.kind === "add" && (
        <AddSlideDialog onAdd={addSlide} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "delete" && (
        <Dialog
          title={t("deleteDialog.title")}
          closeLabel={tCommon("close")}
          onClose={() => setDialog(null)}
        >
          <p className="text-base text-muted">{t("deleteDialog.description")}</p>
          {dialog.error && (
            <p role="alert" className="text-sm text-error-700">
              {t(dialog.error === "ACTIVITY_LOCKED" ? "errors.ACTIVITY_LOCKED" : "errors.generic")}
            </p>
          )}
          <div className="flex justify-end gap-2.5">
            <Button variant="secondary" onClick={() => setDialog(null)}>
              {t("deleteDialog.cancel")}
            </Button>
            <Button
              variant="danger"
              disabled={dialog.pending}
              onClick={() => void confirmDelete(dialog.slideId)}
            >
              {t("deleteDialog.confirm")}
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
