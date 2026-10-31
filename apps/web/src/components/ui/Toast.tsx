"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ToastTone = "info" | "success" | "error";

export interface ToastOptions {
  tone?: ToastTone;
  /** Milliseconds before it hides. 0 keeps it until closed. */
  duration?: number;
  /** A button in the toast, such as Undo. Pressing it also closes the toast. */
  action?: { label: string; onClick: () => void };
}

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastOptions["action"];
}

const toneClass: Record<ToastTone, string> = {
  info: "bg-neutral-900 text-white",
  success: "bg-success-700 text-white",
  error: "bg-error-700 text-white",
};

const ToastContext = createContext<((message: string, options?: ToastOptions) => void) | null>(
  null,
);

export function ToastProvider({
  children,
  closeLabel,
}: {
  children: ReactNode;
  closeLabel: string;
}) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (message: string, { tone = "info", duration = 4000, action }: ToastOptions = {}) => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current, { id, message, tone, action }]);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-lg py-2 pr-2 pl-4 text-sm shadow-md",
              toneClass[toast.tone],
            )}
          >
            <p className="flex-1">{toast.message}</p>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action?.onClick();
                  dismiss(toast.id);
                }}
                className="h-11 shrink-0 rounded-md px-3 font-semibold underline hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label={closeLabel}
              onClick={() => dismiss(toast.id)}
              className="grid size-11 shrink-0 place-items-center rounded-md hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
            >
              <svg
                width="18"
                height="18"
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
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** `const toast = useToast(); toast("Saved", { tone: "success" })` */
export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast must be used inside <ToastProvider>");
  return show;
}
