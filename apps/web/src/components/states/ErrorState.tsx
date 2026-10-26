import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** MD-15 E04/E05: rose icon tile, title, reason, then the actions. */
export function ErrorState({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center",
        className,
      )}
    >
      <div className="grid size-24 place-items-center rounded-2xl bg-error-50 text-error-700">
        <svg
          width="44"
          height="44"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        {description && <p className="text-base text-muted">{description}</p>}
      </div>
      {actions && <div className="flex w-full max-w-xs flex-col gap-2.5">{actions}</div>}
    </div>
  );
}
