"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * MD-15 H01 dialog: dimmed page, white panel, title with a close button, then the body.
 * Escape and the backdrop close it; focus moves inside on open and back to the opener on close.
 */
export function Dialog({
  title,
  closeLabel,
  onClose,
  children,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Autofocus the first field if there is one, else the panel itself.
    (panel?.querySelector<HTMLElement>("[autofocus], input") ?? panel)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      opener?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto px-4 pt-[15vh] pb-8">
      <div aria-hidden="true" className="fixed inset-0 bg-neutral-900/45" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex w-full max-w-120 flex-col gap-5 rounded-2xl bg-background p-6 shadow-md focus-visible:outline-none"
      >
        <div className="flex items-center justify-between gap-4">
          <h2 id={titleId} className="text-xl font-bold">
            {title}
          </h2>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            className="grid size-11 shrink-0 place-items-center rounded-md text-neutral-700 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
