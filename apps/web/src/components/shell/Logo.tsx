import { cn } from "@/lib/cn";

/** Orange tile with the screen icon, from every MD-15 header. */
export function LogoMark({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center bg-primary-500 text-white",
        size === "lg" ? "size-11 rounded-lg" : "size-8 rounded-md",
      )}
    >
      <svg
        width={size === "lg" ? 24 : 18}
        height={size === "lg" ? 24 : 18}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="5" width="18" height="12" rx="2" />
        <path d="M8 21h8" />
      </svg>
    </span>
  );
}

export function Logo({ size = "md", className }: { size?: "md" | "lg"; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", size === "lg" && "gap-3", className)}>
      <LogoMark size={size} />
      <span className={cn("font-bold tracking-tight", size === "lg" ? "text-2xl" : "text-lg")}>
        ModDeck
      </span>
    </span>
  );
}
