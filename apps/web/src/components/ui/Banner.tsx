import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type BannerTone = "info" | "warning" | "success";

// One component for every status line above a screen: reconnecting, host
// reconnecting, Q&A closed, session full (technical design §2.4).
const toneClass: Record<BannerTone, string> = {
  info: "bg-primary-50 text-primary-700",
  warning: "bg-warning-50 text-warning-800",
  success: "bg-success-50 text-success-800",
};

export interface BannerProps extends HTMLAttributes<HTMLDivElement> {
  tone?: BannerTone;
}

export function Banner({ tone = "info", className, children, ...props }: BannerProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2 px-4 py-2 text-sm font-medium",
        toneClass[tone],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
