"use client";

import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { SLIDE_IMAGE_MAX_BYTES, SLIDE_IMAGE_TYPES } from "@moddeck/shared";
import { cn } from "@/lib/cn";
import { KindIcon } from "./KindIcon";

export type InsertKind = "heading" | "text" | "code" | "math";

const buttonClass =
  "inline-flex h-11 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-semibold text-neutral-800 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50";

/**
 * The bar above the slide (Canva's add menu): put a heading, text, code, a formula or an image
 * on the slide. A new element is selected and, for text, code and formulas, ready to type in.
 */
export function InsertBar({
  disabled,
  onInsert,
  onInsertImage,
  onImageRejected,
}: {
  disabled: boolean;
  onInsert: (kind: InsertKind) => void;
  onInsertImage: (file: File) => Promise<void>;
  /** The file was not an accepted type or was too large. */
  onImageRejected: (reason: "type" | "size") => void;
}) {
  const t = useTranslations("editor.insert");
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function choose(file: File | undefined) {
    if (!file) return;
    if (!(SLIDE_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      onImageRejected("type");
    } else if (file.size > SLIDE_IMAGE_MAX_BYTES) {
      onImageRejected("size");
    } else {
      setUploading(true);
      try {
        await onInsertImage(file);
      } finally {
        setUploading(false);
      }
    }
    if (input.current) input.current.value = "";
  }

  const entries: { kind: InsertKind; icon: "text" | "code" | "math" }[] = [
    { kind: "heading", icon: "text" },
    { kind: "text", icon: "text" },
    { kind: "code", icon: "code" },
    { kind: "math", icon: "math" },
  ];

  return (
    <div role="group" aria-label={t("label")} className="flex flex-wrap items-center gap-2">
      {entries.map(({ kind, icon }) => (
        <button
          key={kind}
          type="button"
          disabled={disabled}
          onClick={() => onInsert(kind)}
          className={buttonClass}
        >
          <KindIcon kind={icon} />
          {t(kind)}
        </button>
      ))}
      <input
        ref={input}
        id={id}
        type="file"
        accept={SLIDE_IMAGE_TYPES.join(",")}
        disabled={disabled || uploading}
        onChange={(event) => void choose(event.target.files?.[0])}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        className={cn(
          buttonClass,
          "cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-ring",
          (disabled || uploading) && "pointer-events-none opacity-50",
        )}
      >
        <KindIcon kind="image" />
        {uploading ? t("uploading") : t("image")}
      </label>
    </div>
  );
}
