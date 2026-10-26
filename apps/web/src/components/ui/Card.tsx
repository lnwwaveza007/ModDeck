import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type CardTone = "default" | "accent";

// accent = the orange-tinted session card on the MD-15 join screen.
const toneClass: Record<CardTone, string> = {
  default: "border-neutral-200 bg-background",
  accent: "border-primary-200 bg-primary-50",
};

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: CardTone;
}

export function Card({ tone = "default", className, ...props }: CardProps) {
  return (
    <div className={cn("rounded-xl border p-5 shadow-sm", toneClass[tone], className)} {...props} />
  );
}
