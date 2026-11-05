import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** A key hint next to a control (MD-15 H05). Decorative: the help panel lists the keys. */
export function Kbd({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <kbd
      aria-hidden="true"
      className={cn(
        "rounded border px-1.5 font-mono text-[11px] leading-4 font-normal",
        dark
          ? "border-neutral-600 bg-neutral-700 text-neutral-50"
          : "border-neutral-300 bg-neutral-50 text-neutral-700",
      )}
    >
      {children}
    </kbd>
  );
}
