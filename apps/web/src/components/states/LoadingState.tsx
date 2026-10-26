import { cn } from "@/lib/cn";

/** MD-15 E01: spinner + label, centred. */
export function LoadingState({ label, className }: { label: string; className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="size-12 animate-spin rounded-full border-5 border-primary-100 border-t-primary-500 motion-reduce:animate-none"
      />
      <p className="text-base text-muted">{label}</p>
    </div>
  );
}

/** MD-15 E02: grey placeholder block while content loads. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-md bg-neutral-100 motion-reduce:animate-none",
        className,
      )}
    />
  );
}
