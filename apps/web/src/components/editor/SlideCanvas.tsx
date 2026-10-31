"use client";

import { useTranslations } from "next-intl";
import {
  useCallback,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type Ref,
} from "react";
import type { SlideDto, SlideElement } from "@moddeck/shared";
import { SlideRenderer, type FrameDecoration } from "@/components/content/SlideRenderer";
import { cn } from "@/lib/cn";
import {
  elementBox,
  moveBox,
  resizeBox,
  snapTargets,
  updateElement,
  type Box,
  type Handle,
  type SnapTargets,
} from "@/lib/editor/elements";

/** What the page needs from the canvas: how tall an element is, in percent of the stage. */
export interface SlideCanvasHandle {
  measureHeight: (elementId: string) => number;
}

const HANDLES: Record<Handle, string> = {
  n: "top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize",
  s: "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-ns-resize",
  e: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
  w: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
  ne: "top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
  nw: "top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
  se: "bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize",
  sw: "bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize",
};

const ALL_HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const WIDTH_HANDLES: Handle[] = ["w", "e"];

// Which handles an element shows. Text and formulas grow with their content, so only their width
// changes. Code can also be given a fixed height. A picture keeps its shape from the corners.
function handlesOf(element: SlideElement): Handle[] {
  return element.type === "text" || element.type === "math" ? WIDTH_HANDLES : ALL_HANDLES;
}

type Gesture =
  | {
      kind: "move";
      id: string;
      start: Box;
      targets: SnapTargets;
      moved: boolean;
    }
  | { kind: "resize"; id: string; handle: Handle; start: Box };

type Origin = { x: number; y: number; width: number; height: number };

const NUDGE = 0.5;
const NUDGE_BIG = 2;
const DRAG_THRESHOLD = 3;

/**
 * The editable stage (MD-15 H02 canvas). Click an element to select it, drag it to move, drag a
 * handle to resize it, double-click text, code or a formula to edit it in place. The arrow keys
 * nudge, Delete removes, Enter edits, Escape lets go. It draws the slide through the same
 * SlideRenderer the audience sees, so what the host edits is what the projector shows.
 */
export function SlideCanvas({
  slide,
  selectedId,
  editingId,
  onSelect,
  onEditing,
  onChange,
  onDelete,
  onDuplicate,
  onGestureEnd,
  ref,
}: {
  slide: SlideDto;
  selectedId: string | null;
  editingId: string | null;
  onSelect: (elementId: string | null) => void;
  onEditing: (elementId: string | null) => void;
  /** The whole list again, back to front. */
  onChange: (elements: SlideElement[]) => void;
  onDelete: (elementId: string) => void;
  onDuplicate: (elementId: string) => void;
  /** A drag or resize has ended, so the next change is a new step for undo. */
  onGestureEnd?: () => void;
  ref?: Ref<SlideCanvasHandle>;
}) {
  const t = useTranslations("editor.canvas");
  const helpId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const origin = useRef<Origin>({ x: 0, y: 0, width: 1, height: 1 });
  const pointerStart = useRef({ x: 0, y: 0 });
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const elements = slide.elements;

  const measureHeight = useCallback((id: string) => {
    const stage = stageRef.current?.getBoundingClientRect();
    const frame = stageRef.current?.querySelector<HTMLElement>(`[data-element-id="${id}"]`);
    if (!stage || !stage.height || !frame) return 0;
    return (frame.getBoundingClientRect().height / stage.height) * 100;
  }, []);
  useImperativeHandle(ref, () => ({ measureHeight }), [measureHeight]);

  // Capture can fail if the browser has already ended the pointer. The drag then simply goes on
  // without it while the pointer stays over the stage.
  function capture(pointerId: number) {
    try {
      stageRef.current?.setPointerCapture?.(pointerId);
    } catch {
      // Nothing to do.
    }
  }

  function startGesture(event: PointerEvent, next: Gesture) {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    origin.current = {
      x: rect.left,
      y: rect.top,
      width: rect.width || 1,
      height: rect.height || 1,
    };
    pointerStart.current = { x: event.clientX, y: event.clientY };
    gesture.current = next;
    // A resize keeps receiving moves when the pointer leaves the stage. A move waits until it
    // really drags: capturing at once would send the click and double-click to the stage and
    // not to the element, and a double-click edits the text.
    if (next.kind === "resize") capture(event.pointerId);
    rootRef.current?.focus({ preventScroll: true });
  }

  function boxOf(element: SlideElement): Box {
    return elementBox(element, measureHeight(element.id));
  }

  function onFramePointerDown(event: PointerEvent, element: SlideElement) {
    if (event.button !== 0 || editingId === element.id) return;
    event.stopPropagation();
    onSelect(element.id);
    const others = elements.filter((other) => other.id !== element.id).map(boxOf);
    startGesture(event, {
      kind: "move",
      id: element.id,
      start: boxOf(element),
      targets: snapTargets(others),
      moved: false,
    });
  }

  function onHandlePointerDown(event: PointerEvent, element: SlideElement, handle: Handle) {
    if (event.button !== 0) return;
    event.stopPropagation();
    onSelect(element.id);
    startGesture(event, {
      kind: "resize",
      id: element.id,
      handle,
      start: boxOf(element),
    });
  }

  function onStagePointerMove(event: PointerEvent) {
    const current = gesture.current;
    if (!current) return;
    const dxPx = event.clientX - pointerStart.current.x;
    const dyPx = event.clientY - pointerStart.current.y;
    const dx = (dxPx / origin.current.width) * 100;
    const dy = (dyPx / origin.current.height) * 100;

    if (current.kind === "move") {
      if (!current.moved && Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD) return;
      if (!current.moved) capture(event.pointerId);
      current.moved = true;
      // Hold Alt to move without snapping.
      const moved = moveBox(current.start, dx, dy, event.altKey ? undefined : current.targets);
      setGuides(moved.guides);
      onChange(updateElement(elements, current.id, { x: moved.x, y: moved.y }));
      return;
    }

    const element = elements.find((el) => el.id === current.id);
    if (!element) return;
    // Text and formulas grow with their content, so only their width changes. Code does too,
    // until a top or bottom handle gives it a fixed height.
    const widthOnly =
      element.type === "text" ||
      element.type === "math" ||
      (element.type === "code" &&
        element.h === undefined &&
        WIDTH_HANDLES.includes(current.handle));
    const next = resizeBox(current.start, current.handle, dx, dy, {
      keepAspect: element.type === "image",
      widthOnly,
    });
    const change =
      element.type === "image"
        ? next
        : element.type === "code" && !widthOnly
          ? { x: next.x, y: next.y, w: next.w, h: next.h }
          : { x: next.x, w: next.w };
    onChange(updateElement(elements, current.id, change));
  }

  function endGesture(event: PointerEvent) {
    if (!gesture.current) return;
    gesture.current = null;
    setGuides({ x: [], y: [] });
    onGestureEnd?.();
    try {
      stageRef.current?.releasePointerCapture?.(event.pointerId);
    } catch {
      // The browser already let go of the pointer.
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return;
    const element = elements.find((el) => el.id === selectedId);

    if (event.key === "Escape") {
      onSelect(null);
      return;
    }
    if (!element) return;

    const step = event.shiftKey ? NUDGE_BIG : NUDGE;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (event.key in arrows) {
      event.preventDefault();
      const [dx, dy] = arrows[event.key];
      const moved = moveBox(boxOf(element), dx, dy);
      onChange(updateElement(elements, element.id, { x: moved.x, y: moved.y }));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onDelete(element.id);
    } else if (event.key === "Enter" && element.type !== "image") {
      event.preventDefault();
      onEditing(element.id);
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
      event.preventDefault();
      onDuplicate(element.id);
    }
  }

  const decorate = (element: SlideElement): FrameDecoration => {
    const selected = element.id === selectedId;
    const editing = element.id === editingId;
    return {
      props: {
        className: cn(
          "touch-none outline-offset-0",
          editing ? "cursor-text" : "cursor-move",
          selected ? "outline-2 outline-primary-500" : "hover:outline-1 hover:outline-primary-300",
        ),
        onPointerDown: (event) => onFramePointerDown(event, element),
        onDoubleClick: () => element.type !== "image" && onEditing(element.id),
      },
      content:
        editing && element.type !== "image" ? (
          <InlineEditor
            element={element}
            onChange={(change) => onChange(updateElement(elements, element.id, change))}
            onDone={() => onEditing(null)}
            // Escape hands the keyboard back to the canvas, so the arrow keys and Delete work again.
            onEscape={() => rootRef.current?.focus({ preventScroll: true })}
          />
        ) : undefined,
      handles:
        selected && !editing
          ? handlesOf(element).map((handle) => (
              <span
                key={handle}
                data-handle={handle}
                onPointerDown={(event) => onHandlePointerDown(event, element, handle)}
                className={cn(
                  "absolute size-2.5 rounded-sm border-2 border-primary-500 bg-background",
                  HANDLES[handle],
                )}
              />
            ))
          : undefined,
    };
  };

  return (
    <div
      ref={rootRef}
      role="group"
      data-canvas=""
      tabIndex={0}
      aria-label={t("label")}
      aria-describedby={helpId}
      onKeyDown={onKeyDown}
      className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <p id={helpId} className="sr-only">
        {t("help")}
      </p>
      <SlideRenderer
        slide={slide}
        placeholders
        decorate={decorate}
        stageRef={stageRef}
        className="shadow-sm"
        stageProps={{
          onPointerDown: (event) => {
            // A press on empty stage lets go of the selection.
            if (event.target === event.currentTarget) {
              onSelect(null);
              onEditing(null);
              rootRef.current?.focus({ preventScroll: true });
            }
          },
          onPointerMove: onStagePointerMove,
          onPointerUp: endGesture,
          onPointerCancel: endGesture,
        }}
        overlay={
          <>
            {elements.length === 0 && (
              <p className="pointer-events-none absolute inset-0 grid place-items-center px-[8cqw] text-center text-[2.6cqw] text-neutral-400">
                {t("emptyHint")}
              </p>
            )}
            {guides.x.map((x) => (
              <span
                key={`x${x}`}
                aria-hidden="true"
                data-guide="x"
                className="pointer-events-none absolute inset-y-0 w-px bg-primary-500"
                style={{ left: `${x}%` }}
              />
            ))}
            {guides.y.map((y) => (
              <span
                key={`y${y}`}
                aria-hidden="true"
                data-guide="y"
                className="pointer-events-none absolute inset-x-0 h-px bg-primary-500"
                style={{ top: `${y}%` }}
              />
            ))}
          </>
        }
      />
    </div>
  );
}

/** Edits the source of a text, code or formula element where it sits on the slide. */
function InlineEditor({
  element,
  onChange,
  onDone,
  onEscape,
}: {
  element: Exclude<SlideElement, { type: "image" }>;
  onChange: (change: Partial<SlideElement>) => void;
  onDone: () => void;
  onEscape: () => void;
}) {
  const t = useTranslations("content.placeholder");
  const field = useRef<HTMLTextAreaElement>(null);
  const value =
    element.type === "text" ? element.text : element.type === "code" ? element.code : element.latex;

  // The box grows with the text, like the element it stands in for.
  useLayoutEffect(() => {
    const node = field.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [value]);

  const mono = element.type !== "text";
  const fontSize = element.type === "math" ? Math.min(element.size, 2.4) : element.size;

  return (
    <textarea
      ref={field}
      autoFocus
      value={value}
      rows={1}
      spellCheck={false}
      placeholder={t(element.type)}
      aria-label={t(element.type)}
      onFocus={(event) => {
        const end = event.currentTarget.value.length;
        event.currentTarget.setSelectionRange(end, end);
      }}
      onChange={(event) => {
        const next = event.target.value;
        onChange(
          element.type === "text"
            ? { text: next }
            : element.type === "code"
              ? { code: next }
              : { latex: next },
        );
      }}
      onBlur={onDone}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          event.currentTarget.blur();
          onEscape();
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
      style={{
        fontSize: `${fontSize}cqw`,
        textAlign: element.type === "code" ? "left" : element.align,
        fontWeight: element.type === "text" && element.bold ? 700 : 400,
        lineHeight: element.type === "code" ? 1.5 : 1.4,
        whiteSpace: element.type === "code" ? "pre" : "pre-wrap",
        height: element.type === "code" && element.h !== undefined ? "100%" : undefined,
      }}
      className={cn(
        "block w-full resize-none overflow-hidden bg-background/90 p-0 text-foreground outline-none placeholder:text-neutral-400",
        mono && "font-mono",
        element.type === "code" &&
          "overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-[0.8em]",
      )}
    />
  );
}
