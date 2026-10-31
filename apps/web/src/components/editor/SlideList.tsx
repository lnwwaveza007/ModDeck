"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslations } from "next-intl";
import { memo, useMemo } from "react";
import type { SlideDto } from "@moddeck/shared";
import { SlideRenderer } from "@/components/content/SlideRenderer";
import { cn } from "@/lib/cn";

const SlideItem = memo(function SlideItem({
  slide,
  number,
  selected,
  onSelect,
}: {
  slide: SlideDto;
  number: number;
  selected: boolean;
  onSelect: (slideId: string) => void;
}) {
  const t = useTranslations("editor");
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: slide.id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("relative flex gap-2", isDragging && "z-10 opacity-70")}
    >
      <span aria-hidden="true" className="w-5 shrink-0 pt-1 text-right text-sm text-muted">
        {number}
      </span>
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        role="button"
        aria-current={selected ? "true" : undefined}
        aria-label={t("slideLabel", { number, kind: t(`kinds.${slide.kind}`) })}
        onClick={() => onSelect(slide.id)}
        className={cn(
          "min-w-0 flex-1 touch-none rounded-lg p-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          selected ? "ring-2 ring-primary-500" : "hover:ring-2 hover:ring-neutral-300",
        )}
      >
        <SlideRenderer slide={slide} mode="thumbnail" />
      </button>
    </li>
  );
});

/**
 * MD-15 H02 slide list: numbered thumbnails, drag to reorder. The keyboard works too: Space picks
 * a slide up, the arrow keys move it, Space drops it. The toolbar has Move up / Move down.
 */
export function SlideList({
  slides,
  selectedId,
  onSelect,
  onReorder,
}: {
  slides: SlideDto[];
  selectedId: string | null;
  onSelect: (slideId: string) => void;
  onReorder: (slideIds: string[]) => void;
}) {
  const t = useTranslations("editor.drag");
  const ids = useMemo(() => slides.map((slide) => slide.id), [slides]);
  const sensors = useSensors(
    // A small distance keeps a plain click a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Enter stays a normal click on the button; only Space drags.
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );

  const place = (id: string | number) => ids.indexOf(String(id)) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => t("picked", { from: place(active.id) }),
    onDragOver: ({ active, over }) =>
      over ? t("over", { from: place(active.id), to: place(over.id) }) : undefined,
    onDragEnd: ({ active, over }) =>
      t("dropped", { from: place(active.id), to: place(over?.id ?? active.id) }),
    onDragCancel: () => t("cancelled"),
  };

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from !== -1 && to !== -1) onReorder(arrayMove(ids, from, to));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: t("instructions") },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ol className="flex flex-col gap-3">
          {slides.map((slide, index) => (
            <SlideItem
              key={slide.id}
              slide={slide}
              number={index + 1}
              selected={slide.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
