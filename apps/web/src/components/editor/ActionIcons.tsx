"use client";

import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function DuplicateIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 012-2h9" />
    </svg>
  );
}

export function UndoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10a6 6 0 010 12h-3" />
    </svg>
  );
}

export function RedoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H10a6 6 0 000 12h3" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" />
    </svg>
  );
}

/**
 * A square icon button. The label is both the accessible name and the tooltip, since an icon
 * alone says nothing to a screen reader. `danger` is the red one, for delete.
 */
export function IconButton({
  label,
  danger = false,
  className,
  children,
  ...props
}: { label: string; danger?: boolean } & Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "title"
>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={cn(
        "grid size-11 place-items-center rounded-md border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50",
        danger
          ? "border-error-600 bg-error-600 text-white hover:bg-error-700 active:bg-error-800"
          : "border-border bg-background text-neutral-700 hover:bg-surface",
        className,
      )}
    >
      {children}
    </button>
  );
}
