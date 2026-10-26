import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "lg";

// White text needs primary-600 or darker (globals.css), so primary buttons start at 600.
const variantClass: Record<ButtonVariant, string> = {
  primary: "bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800",
  secondary: "border border-border bg-background text-foreground hover:bg-surface",
  ghost: "bg-transparent text-neutral-700 hover:bg-neutral-100",
  danger: "bg-error-600 text-white hover:bg-error-700 active:bg-error-800",
};

// md keeps the 44 px touch target (MD-5 §2.7); lg is the 52 px phone CTA from MD-15.
const sizeClass: Record<ButtonSize, string> = {
  md: "h-11 px-4 text-sm",
  lg: "h-13 px-5 text-base",
};

export const buttonBaseClass =
  "inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50";

export function buttonClass({
  variant = "primary",
  size = "md",
  fullWidth = false,
}: { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean } = {}) {
  return cn(buttonBaseClass, variantClass[variant], sizeClass[size], fullWidth && "w-full");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

export function Button({
  variant,
  size,
  fullWidth,
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonClass({ variant, size, fullWidth }), className)}
      {...props}
    />
  );
}
