"use client";

import { arrayMove } from "@dnd-kit/sortable";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  SLIDE_ELEMENTS_MAX,
  SLIDE_IMAGE_MAX_BYTES,
  type SlideDto,
  type SlideElement,
  type SlideKind,
} from "@moddeck/shared";
import { SlideRenderer } from "@/components/content/SlideRenderer";
import { SessionHeader } from "@/components/shell/SessionHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { LoadingState } from "@/components/states/LoadingState";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api/client";
import {
  createSlide,
  deleteSlide,
  duplicateSlide,
  getDeck,
  reorderSlides,
  saveElements,
  uploadSlideImage,
} from "@/lib/api/slides";
import {
  alignBox,
  copyElement,
  createElement,
  elementBox,
  moveLayer,
  updateElement,
  type AlignEdge,
  type LayerMove,
} from "@/lib/editor/elements";
import { History } from "@/lib/editor/history";
import { readImageAspect } from "@/lib/editor/image";
import { SaveQueue } from "@/lib/editor/save-queue";
import { DuplicateIcon, IconButton, RedoIcon, TrashIcon, UndoIcon } from "./ActionIcons";
import { AddSlideDialog } from "./AddSlideDialog";
import { ElementPanel } from "./ElementPanel";
import { InsertBar, type InsertKind } from "./InsertBar";
import { SaveIndicator } from "./SaveIndicator";
import { SlideCanvas, type SlideCanvasHandle } from "./SlideCanvas";
import { SlideList } from "./SlideList";

type Load =
  { status: "loading" } | { status: "error" } | { status: "notFound" } | { status: "ready" };

/**
 * MD-15 H02 deck editor (F8). Slide list on the left, the slide on a canvas in the middle, the
 * selected element's settings on the right. A slide is a canvas: add a heading, text, code, a
 * formula or an image, then drag it anywhere. Every change autosaves (technical design §3.3).
 */
export function DeckEditor({ deckId }: { deckId: string }) {
  const t = useTranslations("editor");
  const tPages = useTranslations("pages");
  const tStates = useTranslations("states");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const toast = useToast();

  const [queue] = useState(() => new SaveQueue());
  const canvas = useRef<SlideCanvasHandle>(null);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [title, setTitle] = useState("");
  const [slides, setSlides] = useState<SlideDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The element selected on the current slide, and the one being typed into.
  const [elementId, setElementId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // What the host did, for undo and redo. A slide that an undo brings back has a new id on the
  // server, so history keeps the id the slide first had, and these maps go between the two.
  const [history] = useState(() => new History());
  const rootOf = useRef(new Map<string, string>());
  const currentOf = useRef(new Map<string, string>());
  const applying = useRef(false);
  const undoable = useSyncExternalStore(
    history.subscribe,
    () => history.snapshot,
    () => "00",
  );
  // Bumped by "Try again" to load the deck once more.
  const [attempt, setAttempt] = useState(0);

  // The newest slides, for work that finishes after a render (an upload).
  const latest = useRef(slides);
  useEffect(() => {
    latest.current = slides;
  });

  const selectedIndex = slides.findIndex((slide) => slide.id === selectedId);
  const selected = selectedIndex === -1 ? undefined : slides[selectedIndex];
  const elements = selected?.elements;
  const element = elements?.find((el) => el.id === elementId) ?? null;

  const apply = useCallback(
    (deck: { title: string; slides: SlideDto[] }) => {
      setTitle(deck.title);
      setSlides(deck.slides);
      setSelectedId((current) =>
        deck.slides.some((slide) => slide.id === current) ? current : (deck.slides[0]?.id ?? null),
      );
      setElementId(null);
      setEditingId(null);
      // What the server has replaces what the host did, so older steps no longer fit.
      history.clear();
      rootOf.current.clear();
      currentOf.current.clear();
      setLoad({ status: "ready" });
    },
    [history],
  );

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

  function selectSlide(slideId: string) {
    setSelectedId(slideId);
    setElementId(null);
    setEditingId(null);
  }

  // The canvas changed: show it at once and save it after a short pause.
  function setElements(slideId: string, next: SlideElement[]) {
    const before = latest.current.find((slide) => slide.id === slideId)?.elements;
    if (!before) return;
    latest.current = latest.current.map((slide) =>
      slide.id === slideId ? { ...slide, elements: next } : slide,
    );
    if (!applying.current) history.record(rootId(slideId), before, next);
    setSlides(latest.current);
    queue.patch(slideId, { elements: next }, (body) =>
      saveElements(deckId, slideId, body.elements),
    );
  }

  function insertElement(kind: InsertKind) {
    if (!selected || selected.elements.length >= SLIDE_ELEMENTS_MAX) return;
    const created = createElement(kind, { index: selected.elements.length });
    history.breakGroup();
    setElements(selected.id, [...selected.elements, created]);
    history.breakGroup();
    setElementId(created.id);
    // Type straight away, like adding a text box in a design tool.
    setEditingId(created.id);
  }

  async function insertImage(file: File) {
    if (!selected || selected.elements.length >= SLIDE_ELEMENTS_MAX) return;
    const slide = selected;
    try {
      const [{ imageRef }, imageAspect] = await Promise.all([
        queue.run(() => uploadSlideImage(deckId, file)),
        readImageAspect(file),
      ]);
      // The list may have changed while the file uploaded, so build on the newest one.
      const current = latest.current.find((s) => s.id === slide.id);
      if (!current) return;
      const created = createElement("image", {
        index: current.elements.length,
        imageRef,
        imageAspect,
      });
      history.breakGroup();
      setElements(slide.id, [...current.elements, created]);
      history.breakGroup();
      setElementId(created.id);
    } catch (error) {
      recover(error);
    }
  }

  function rejectImage(reason: "type" | "size") {
    toast(
      reason === "type"
        ? t("errors.imageType")
        : t("errors.imageSize", { size: SLIDE_IMAGE_MAX_BYTES / (1024 * 1024) }),
      { tone: "error" },
    );
  }

  function changeElement(change: Partial<SlideElement>) {
    if (!selected || !element) return;
    setElements(selected.id, updateElement(selected.elements, element.id, change));
  }

  function alignElement(edge: AlignEdge) {
    if (!selected || !element) return;
    const box = elementBox(element, canvas.current?.measureHeight(element.id) ?? 0);
    history.breakGroup();
    setElements(selected.id, updateElement(selected.elements, element.id, alignBox(box, edge)));
    history.breakGroup();
  }

  function layerElement(move: LayerMove) {
    if (!selected || !element) return;
    history.breakGroup();
    setElements(selected.id, moveLayer(selected.elements, element.id, move));
    history.breakGroup();
  }

  function duplicateElement(id = element?.id) {
    if (!selected || !id || selected.elements.length >= SLIDE_ELEMENTS_MAX) return;
    const index = selected.elements.findIndex((el) => el.id === id);
    if (index === -1) return;
    const copy = copyElement(selected.elements[index]);
    const next = [...selected.elements];
    next.splice(index + 1, 0, copy);
    history.breakGroup();
    setElements(selected.id, next);
    history.breakGroup();
    setElementId(copy.id);
  }

  function deleteElement(id = element?.id) {
    if (!selected || !id) return;
    history.breakGroup();
    setElements(
      selected.id,
      selected.elements.filter((el) => el.id !== id),
    );
    history.breakGroup();
    setElementId(null);
    setEditingId(null);
  }

  async function replaceImage(file: File) {
    if (!selected || !element || element.type !== "image") return;
    const { id } = element;
    const slideId = selected.id;
    const { imageRef } = await queue.run(() => uploadSlideImage(deckId, file));
    const current = latest.current.find((s) => s.id === slideId);
    if (!current) return;
    history.breakGroup();
    setElements(slideId, updateElement(current.elements, id, { imageRef }));
    history.breakGroup();
  }

  // The id a slide had when history first saw it, and the id it has now.
  const rootId = (id: string) => rootOf.current.get(id) ?? id;
  const currentId = (root: string) => currentOf.current.get(root) ?? root;

  const snapshotOf = (slide: SlideDto) => ({
    kind: slide.kind,
    position: slide.position,
    elements: slide.elements,
  });

  function showSlides(next: SlideDto[]) {
    latest.current = next.map((slide, position) => ({ ...slide, position }));
    setSlides(latest.current);
  }

  /** Puts a slide on the server and in the list, in the place it had. */
  async function recreateSlide(snapshot: ReturnType<typeof snapshotOf>, originalId: string) {
    const position = Math.min(snapshot.position, latest.current.length);
    const slide = await queue.run(() =>
      createSlide(deckId, {
        kind: snapshot.kind,
        position,
        ...(snapshot.kind === "content" && { elements: snapshot.elements }),
      }),
    );
    const root = rootId(originalId);
    currentOf.current.set(root, slide.id);
    rootOf.current.set(slide.id, root);
    const next = [...latest.current];
    next.splice(slide.position, 0, slide);
    showSlides(next);
    selectSlide(slide.id);
  }

  /** Takes a slide off the server and out of the list, and moves the selection to a neighbour. */
  async function removeSlide(slideId: string) {
    await queue.run(() => deleteSlide(deckId, slideId));
    const index = latest.current.findIndex((slide) => slide.id === slideId);
    const rest = latest.current.filter((slide) => slide.id !== slideId);
    showSlides(rest);
    setSelectedId((current) =>
      current === slideId ? (rest[index]?.id ?? rest[index - 1]?.id ?? null) : current,
    );
    setElementId(null);
    setEditingId(null);
  }

  /** What undo and redo do for a slide that was added or copied: take it away, bring it back. */
  function rememberNewSlide(slide: SlideDto) {
    const root = rootId(slide.id);
    let snapshot = snapshotOf(slide);
    history.pushCommand({
      undo: async () => {
        const now = latest.current.find((s) => s.id === currentId(root));
        if (now) snapshot = snapshotOf(now);
        await removeSlide(currentId(root));
      },
      redo: () => recreateSlide(snapshot, root),
    });
  }

  function addSlide(kind: SlideKind) {
    setAddOpen(false);
    const position = selectedIndex === -1 ? slides.length : selectedIndex + 1;
    queue
      .run(() => createSlide(deckId, { kind, position }))
      .then((slide) => {
        const next = [...latest.current];
        next.splice(slide.position, 0, slide);
        showSlides(next);
        selectSlide(slide.id);
        rememberNewSlide(slide);
        toast(t("toasts.added"), { tone: "success" });
      }, recover);
  }

  function duplicateSlideAction() {
    if (!selected) return;
    queue
      .run(() => duplicateSlide(deckId, selected.id))
      .then((slide) => {
        const next = [...latest.current];
        next.splice(slide.position, 0, slide);
        showSlides(next);
        selectSlide(slide.id);
        rememberNewSlide(slide);
        toast(t("toasts.duplicated"), { tone: "success" });
      }, recover);
  }

  async function applyOrder(slideIds: string[]) {
    const byId = new Map(latest.current.map((slide) => [slide.id, slide]));
    showSlides(slideIds.flatMap((id) => byId.get(id) ?? []));
    await queue.run(() => reorderSlides(deckId, slideIds));
  }

  function reorder(slideIds: string[]) {
    const before = latest.current.map((slide) => rootId(slide.id));
    const after = slideIds.map(rootId);
    applyOrder(slideIds).then(() => undefined, recover);
    history.pushCommand({
      undo: () => applyOrder(before.map(currentId)),
      redo: () => applyOrder(after.map(currentId)),
    });
  }

  function moveSlide(delta: -1 | 1) {
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

  /** No confirmation: Undo brings the slide back, in its place and with its content. */
  async function deleteSlideAction() {
    if (!selected) return;
    const target = selected;
    const snapshot = snapshotOf(target);
    const root = rootId(target.id);
    try {
      await removeSlide(target.id);
    } catch (error) {
      recover(error);
      return;
    }
    history.pushCommand({
      undo: () => recreateSlide(snapshot, root),
      redo: () => removeSlide(currentId(root)),
    });
    toast(t("toasts.deleted"), {
      tone: "success",
      action: { label: t("toasts.undo"), onClick: () => void undo() },
    });
  }

  // Puts a slide's elements back as they were, and shows that slide.
  function applyElements(root: string, next: SlideElement[]) {
    const slideId = currentId(root);
    // The slide is gone, so the step cannot be applied and stays where it was.
    if (!latest.current.some((slide) => slide.id === slideId)) throw new Error("slide missing");
    applying.current = true;
    try {
      setElements(slideId, next);
    } finally {
      applying.current = false;
    }
    setSelectedId(slideId);
    setElementId(null);
    setEditingId(null);
  }

  // One step at a time: a step that asks the server must finish before the next one starts, or
  // it would look for a slide that is not back yet.
  const turn = useRef<Promise<void>>(Promise.resolve());
  const waiting = useRef(0);
  function inOrder(step: () => Promise<void> | void) {
    // A canvas step is done at once. A slide step asks the server and returns a promise; the
    // steps after it queue up behind it.
    let result: Promise<void> | void;
    try {
      result = waiting.current === 0 ? step() : turn.current.then(step);
    } catch (error) {
      recover(error);
      return;
    }
    if (!result) return;
    waiting.current++;
    turn.current = result.catch(recover).finally(() => {
      waiting.current--;
    });
  }

  const undo = () => inOrder(() => history.undo(applyElements));
  const redo = () => inOrder(() => history.redo(applyElements));

  // Ctrl or Cmd + Z undoes, with Shift (or Ctrl + Y) redoes. A text box keeps its own undo.
  const keys = useRef({ undo, redo });
  useEffect(() => {
    keys.current = { undo, redo };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (["TEXTAREA", "INPUT", "SELECT"].includes((event.target as HTMLElement).tagName)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        void keys.current.undo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        void keys.current.redo();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

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
    <Button variant="secondary" fullWidth onClick={() => setAddOpen(true)}>
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
            onSelect={selectSlide}
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
                <IconButton
                  label={t("toolbar.undo")}
                  disabled={undoable[0] !== "1"}
                  onClick={() => void undo()}
                >
                  <UndoIcon />
                </IconButton>
                <IconButton
                  label={t("toolbar.redo")}
                  disabled={undoable[1] !== "1"}
                  onClick={() => void redo()}
                >
                  <RedoIcon />
                </IconButton>
                <Button
                  variant="ghost"
                  disabled={selectedIndex === 0}
                  onClick={() => moveSlide(-1)}
                >
                  {t("toolbar.moveUp")}
                </Button>
                <Button
                  variant="ghost"
                  disabled={selectedIndex === slides.length - 1}
                  onClick={() => moveSlide(1)}
                >
                  {t("toolbar.moveDown")}
                </Button>
                <IconButton label={t("toolbar.duplicate")} onClick={duplicateSlideAction}>
                  <DuplicateIcon />
                </IconButton>
                <IconButton
                  danger
                  label={t("toolbar.delete")}
                  onClick={() => void deleteSlideAction()}
                >
                  <TrashIcon />
                </IconButton>
              </div>

              {selected.kind === "content" && (
                <InsertBar
                  disabled={selected.elements.length >= SLIDE_ELEMENTS_MAX}
                  onInsert={insertElement}
                  onInsertImage={insertImage}
                  onImageRejected={rejectImage}
                />
              )}

              <div className="mx-auto w-full max-w-240">
                {selected.kind === "content" ? (
                  <SlideCanvas
                    key={selected.id}
                    ref={canvas}
                    slide={selected}
                    selectedId={elementId}
                    editingId={editingId}
                    onSelect={(id) => {
                      history.breakGroup();
                      setElementId(id);
                      if (id !== editingId) setEditingId(null);
                    }}
                    onEditing={(id) => {
                      history.breakGroup();
                      setEditingId(id);
                    }}
                    onGestureEnd={() => history.breakGroup()}
                    onChange={(next) => setElements(selected.id, next)}
                    onDelete={deleteElement}
                    onDuplicate={duplicateElement}
                  />
                ) : (
                  <SlideRenderer slide={selected} className="shadow-sm" />
                )}
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
            <ElementPanel
              key={`${selected.id}:${element?.id ?? ""}`}
              slide={selected}
              selected={element}
              onSelect={(id) => {
                setElementId(id);
                setEditingId(null);
              }}
              onChange={changeElement}
              onAlign={alignElement}
              onLayer={layerElement}
              onDuplicate={() => duplicateElement()}
              onDelete={() => deleteElement()}
              onUploadImage={replaceImage}
            />
          </aside>
        )}
      </div>

      {addOpen && <AddSlideDialog onAdd={addSlide} onClose={() => setAddOpen(false)} />}
    </>
  );
}
