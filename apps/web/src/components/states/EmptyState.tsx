import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** MD-15 E03: icon tile, title, one line of help, optional action. */
export function EmptyState({
  title,
  description,
  icon,
  action,
  titleAs: Title = "h2",
  className,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  titleAs?: "h1" | "h2";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center",
        className,
      )}
    >
      <div className="grid size-24 place-items-center rounded-2xl border border-neutral-200 bg-background text-neutral-400">
        {icon ?? <InboxIcon />}
      </div>
      <div className="flex flex-col gap-1.5">
        <Title className="text-xl font-bold text-foreground">{title}</Title>
        {description && <p className="text-base text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function InboxIcon() {
  return (
    <svg
      width="44"
      height="44"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}
