import type { SlideKind } from "@moddeck/shared";

export type TileKind = SlideKind | "qa";

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** Small icon for a slide type, on the add-slide tiles. */
export function KindIcon({ kind }: { kind: TileKind }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      {kind === "text" && <path d="M5 6h14M5 11h14M5 16h9" />}
      {kind === "code" && <path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 5l-4 14" />}
      {kind === "math" && <path d="M18 5H7l6 7-6 7h11" />}
      {kind === "image" && (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="M21 16l-5-5-9 9" />
        </>
      )}
      {kind === "poll" && <path d="M5 20V10M12 20V4M19 20v-7" />}
      {kind === "word_cloud" && <path d="M7 18a4 4 0 010-8 5 5 0 019.6-1.2A3.6 3.6 0 0117 18z" />}
      {kind === "qa" && (
        <>
          <path d="M4 5h16v11H9l-5 4z" />
          <path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1-1.5 2M12 15h.01" />
        </>
      )}
    </svg>
  );
}
