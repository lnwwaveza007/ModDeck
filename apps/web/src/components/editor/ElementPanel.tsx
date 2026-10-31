"use client";

import { useTranslations } from "next-intl";
import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CODE_LANGUAGES,
  ELEMENT_TEXT_MAX,
  SLIDE_IMAGE_MAX_BYTES,
  SLIDE_IMAGE_TYPES,
  TEXT_ALIGNS,
  isActivityKind,
  isCodeLanguage,
  type SlideDto,
  type SlideElement,
  type TextAlign,
} from "@moddeck/shared";
import { buttonClass } from "@/components/ui/Button";
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import {
  SIZE_STEP,
  TEXT_PRESETS,
  clampSize,
  presetOf,
  type AlignEdge,
  type LayerMove,
  type TextPreset,
} from "@/lib/editor/elements";
import { renderMath } from "@/lib/render/math";
import { DuplicateIcon, IconButton, TrashIcon } from "./ActionIcons";

const IMAGE_MB = SLIDE_IMAGE_MAX_BYTES / (1024 * 1024);

const fieldClass =
  "w-full rounded-md border border-border bg-background p-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

const iconButtonClass =
  "grid size-10 place-items-center rounded-md border border-border bg-background text-neutral-700 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:opacity-40 aria-pressed:border-primary-500 aria-pressed:bg-primary-50 aria-pressed:text-primary-800";

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const ALIGN_TO_SLIDE: Record<AlignEdge, ReactNode> = {
  left: (
    <>
      <path d="M4 4v16" />
      <rect x="7" y="7" width="12" height="4" />
      <rect x="7" y="13" width="7" height="4" />
    </>
  ),
  hcenter: (
    <>
      <path d="M12 4v16" />
      <rect x="5" y="7" width="14" height="4" />
      <rect x="8" y="13" width="8" height="4" />
    </>
  ),
  right: (
    <>
      <path d="M20 4v16" />
      <rect x="5" y="7" width="12" height="4" />
      <rect x="10" y="13" width="7" height="4" />
    </>
  ),
  top: (
    <>
      <path d="M4 4h16" />
      <rect x="7" y="7" width="4" height="12" />
      <rect x="13" y="7" width="4" height="7" />
    </>
  ),
  vcenter: (
    <>
      <path d="M4 12h16" />
      <rect x="7" y="5" width="4" height="14" />
      <rect x="13" y="8" width="4" height="8" />
    </>
  ),
  bottom: (
    <>
      <path d="M4 20h16" />
      <rect x="7" y="5" width="4" height="12" />
      <rect x="13" y="10" width="4" height="7" />
    </>
  ),
};

const TEXT_ALIGN_ICONS: Record<TextAlign, ReactNode> = {
  left: <path d="M4 6h16M4 11h10M4 16h14M4 21h8" />,
  center: <path d="M4 6h16M7 11h10M5 16h14M8 21h8" />,
  right: <path d="M4 6h16M10 11h10M6 16h14M12 21h8" />,
};

const LAYER_ICONS: Record<LayerMove, ReactNode> = {
  front: (
    <>
      <rect x="9" y="9" width="11" height="11" />
      <path d="M4 15V4h11" />
    </>
  ),
  forward: (
    <>
      <rect x="8" y="8" width="12" height="12" />
      <path d="M4 14V4h10" strokeDasharray="2 2" />
    </>
  ),
  backward: (
    <>
      <rect x="4" y="4" width="12" height="12" strokeDasharray="2 2" />
      <path d="M10 20h10V10" />
    </>
  ),
  back: (
    <>
      <rect x="4" y="4" width="11" height="11" />
      <path d="M9 20h11V9" />
    </>
  ),
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-neutral-200 pt-3">
      <h3 className="text-sm font-semibold text-muted">{title}</h3>
      {children}
    </section>
  );
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      {children}
    </svg>
  );
}

/**
 * MD-15 H02 side panel: what the selected element can be set to (style, alignment, position,
 * layer), or the layers and a hint when nothing is selected. Every change autosaves.
 */
export function ElementPanel({
  slide,
  selected,
  onSelect,
  onChange,
  onAlign,
  onLayer,
  onDuplicate,
  onDelete,
  onUploadImage,
}: {
  slide: SlideDto;
  selected: SlideElement | null;
  onSelect: (elementId: string) => void;
  onChange: (change: Partial<SlideElement>) => void;
  onAlign: (edge: AlignEdge) => void;
  onLayer: (move: LayerMove) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onUploadImage: (file: File) => Promise<void>;
}) {
  const t = useTranslations("editor");

  if (isActivityKind(slide.kind)) {
    return (
      <section aria-label={t("panel.editActivity")} className="flex flex-col gap-4">
        <h2 className="text-lg font-bold">{t("panel.editActivity")}</h2>
        <p className="rounded-md bg-neutral-100 p-3 text-sm text-muted">
          {t("panel.activityComingSoon")}
        </p>
      </section>
    );
  }

  if (!selected) {
    return (
      <section aria-label={t("panel.slide")} className="flex flex-col gap-4">
        <h2 className="text-lg font-bold">{t("panel.slide")}</h2>
        <p className="text-sm text-muted">{t("panel.slideHint")}</p>
        <LayerList elements={slide.elements} selectedId={null} onSelect={onSelect} />
      </section>
    );
  }

  return (
    <section aria-label={t(`panel.element.${selected.type}`)} className="flex flex-col gap-4">
      <h2 className="text-lg font-bold">{t(`panel.element.${selected.type}`)}</h2>

      {selected.type === "text" && <TextControls element={selected} onChange={onChange} />}
      {selected.type === "code" && <CodeControls element={selected} onChange={onChange} />}
      {selected.type === "math" && <MathControls element={selected} onChange={onChange} />}
      {selected.type === "image" && (
        <ImageControls hasImage={selected.imageRef !== null} onUpload={onUploadImage} />
      )}

      <Section title={t("panel.position")}>
        <div role="group" aria-label={t("panel.position")} className="flex flex-wrap gap-1.5">
          {(Object.keys(ALIGN_TO_SLIDE) as AlignEdge[]).map((edge) => (
            <button
              key={edge}
              type="button"
              aria-label={t(`panel.alignToSlide.${edge}`)}
              title={t(`panel.alignToSlide.${edge}`)}
              onClick={() => onAlign(edge)}
              className={iconButtonClass}
            >
              <Icon>{ALIGN_TO_SLIDE[edge]}</Icon>
            </button>
          ))}
        </div>
      </Section>

      <Section title={t("panel.layer")}>
        <div role="group" aria-label={t("panel.layer")} className="flex flex-wrap gap-1.5">
          {(Object.keys(LAYER_ICONS) as LayerMove[]).map((move) => {
            const index = slide.elements.findIndex((el) => el.id === selected.id);
            const atFront = index === slide.elements.length - 1;
            const atBack = index === 0;
            const disabled =
              (atFront && (move === "front" || move === "forward")) ||
              (atBack && (move === "back" || move === "backward"));
            return (
              <button
                key={move}
                type="button"
                disabled={disabled}
                aria-label={t(`panel.layerMove.${move}`)}
                title={t(`panel.layerMove.${move}`)}
                onClick={() => onLayer(move)}
                className={iconButtonClass}
              >
                <Icon>{LAYER_ICONS[move]}</Icon>
              </button>
            );
          })}
        </div>
      </Section>

      <div className="flex gap-2 border-t border-neutral-200 pt-3">
        <IconButton label={t("panel.duplicate")} onClick={onDuplicate}>
          <DuplicateIcon />
        </IconButton>
        <IconButton danger label={t("panel.delete")} onClick={onDelete}>
          <TrashIcon />
        </IconButton>
      </div>

      <LayerList elements={slide.elements} selectedId={selected.id} onSelect={onSelect} />
    </section>
  );
}

function LayerList({
  elements,
  selectedId,
  onSelect,
}: {
  elements: SlideElement[];
  selectedId: string | null;
  onSelect: (elementId: string) => void;
}) {
  const t = useTranslations("editor.layers");
  // Front first, like a layers list in a design tool.
  const items = [...elements].reverse();

  return (
    <Section title={t("title")}>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{t("none")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((element) => {
            const source =
              element.type === "text"
                ? element.text
                : element.type === "code"
                  ? element.code
                  : element.type === "math"
                    ? element.latex
                    : "";
            const preview = source.trim().replace(/\s+/g, " ").slice(0, 28);
            return (
              <li key={element.id}>
                <button
                  type="button"
                  aria-current={element.id === selectedId ? "true" : undefined}
                  onClick={() => onSelect(element.id)}
                  className={cn(
                    "flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-ring",
                    element.id === selectedId && "bg-primary-50 font-semibold text-primary-800",
                  )}
                >
                  <span className="shrink-0">{t(`types.${element.type}`)}</span>
                  <span className="truncate text-muted">
                    {element.type === "image" ? "" : preview || t("empty")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function SizeStepper({ size, onChange }: { size: number; onChange: (size: number) => void }) {
  const t = useTranslations("editor.panel");
  return (
    <div role="group" aria-label={t("size")} className="flex items-center gap-1.5">
      <button
        type="button"
        aria-label={t("smaller")}
        onClick={() => onChange(clampSize(size - SIZE_STEP))}
        className={iconButtonClass}
      >
        <Icon>
          <path d="M6 12h12" />
        </Icon>
      </button>
      <output aria-label={t("size")} className="min-w-12 text-center text-sm font-semibold">
        {size}
      </output>
      <button
        type="button"
        aria-label={t("larger")}
        onClick={() => onChange(clampSize(size + SIZE_STEP))}
        className={iconButtonClass}
      >
        <Icon>
          <path d="M6 12h12M12 6v12" />
        </Icon>
      </button>
    </div>
  );
}

function AlignButtons({
  value,
  onChange,
}: {
  value: TextAlign;
  onChange: (align: TextAlign) => void;
}) {
  const t = useTranslations("editor.panel");
  return (
    <div role="group" aria-label={t("textAlign")} className="flex gap-1.5">
      {TEXT_ALIGNS.map((align) => (
        <button
          key={align}
          type="button"
          aria-pressed={value === align}
          aria-label={t(`align.${align}`)}
          title={t(`align.${align}`)}
          onClick={() => onChange(align)}
          className={iconButtonClass}
        >
          <Icon>{TEXT_ALIGN_ICONS[align]}</Icon>
        </button>
      ))}
    </div>
  );
}

function TextControls({
  element,
  onChange,
}: {
  element: Extract<SlideElement, { type: "text" }>;
  onChange: (change: Partial<SlideElement>) => void;
}) {
  const t = useTranslations("editor.panel");
  const id = useId();
  const preset = presetOf(element);

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-text`} className="text-sm font-semibold">
          {t("text")}
        </label>
        <textarea
          id={`${id}-text`}
          aria-describedby={`${id}-help`}
          rows={5}
          maxLength={ELEMENT_TEXT_MAX.text}
          value={element.text}
          onChange={(event) => onChange({ text: event.target.value })}
          className={fieldClass}
        />
        <p id={`${id}-help`} className="text-sm text-muted">
          {t("textHelp")}
        </p>
      </div>

      <Section title={t("style")}>
        <div role="group" aria-label={t("style")} className="grid grid-cols-2 gap-1.5">
          {(Object.keys(TEXT_PRESETS) as TextPreset[]).map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={preset === name}
              onClick={() => onChange({ ...TEXT_PRESETS[name] })}
              className={cn(iconButtonClass, "w-full px-2 text-sm font-semibold")}
            >
              {t(`presets.${name}`)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SizeStepper size={element.size} onChange={(size) => onChange({ size })} />
          <button
            type="button"
            aria-pressed={element.bold}
            aria-label={t("bold")}
            title={t("bold")}
            onClick={() => onChange({ bold: !element.bold })}
            className={cn(iconButtonClass, "font-bold")}
          >
            B
          </button>
        </div>
        <AlignButtons value={element.align} onChange={(align) => onChange({ align })} />
      </Section>
    </>
  );
}

function CodeControls({
  element,
  onChange,
}: {
  element: Extract<SlideElement, { type: "code" }>;
  onChange: (change: Partial<SlideElement>) => void;
}) {
  const t = useTranslations("editor");
  const id = useId();

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-lang`} className="text-sm font-semibold">
          {t("panel.language")}
        </label>
        <select
          id={`${id}-lang`}
          value={element.language}
          onChange={(event) => {
            if (isCodeLanguage(event.target.value)) onChange({ language: event.target.value });
          }}
          className={cn(fieldClass, "h-11 py-0")}
        >
          {CODE_LANGUAGES.map((name) => (
            <option key={name} value={name}>
              {t(`languages.${name}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-code`} className="text-sm font-semibold">
          {t("panel.code")}
        </label>
        <textarea
          id={`${id}-code`}
          rows={10}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="off"
          maxLength={ELEMENT_TEXT_MAX.code}
          value={element.code}
          onChange={(event) => onChange({ code: event.target.value })}
          className={cn(fieldClass, "font-mono text-sm leading-[1.5] whitespace-pre")}
        />
      </div>
      <Section title={t("panel.size")}>
        <SizeStepper size={element.size} onChange={(size) => onChange({ size })} />
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={element.h !== undefined}
            onChange={(event) =>
              onChange({
                h: event.target.checked ? Math.max(4, Math.min(40, 100 - element.y)) : undefined,
              })
            }
            className="size-4 accent-primary-600"
          />
          {t("panel.fixedHeight")}
        </label>
      </Section>
    </>
  );
}

function MathControls({
  element,
  onChange,
}: {
  element: Extract<SlideElement, { type: "math" }>;
  onChange: (change: Partial<SlideElement>) => void;
}) {
  const t = useTranslations("editor.panel");
  const id = useId();

  // The same check the canvas runs, so the message shows under the field as the host types.
  const error = useMemo(() => {
    const result = renderMath(element.latex);
    return result.ok ? undefined : result.error;
  }, [element.latex]);

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-math`} className="text-sm font-semibold">
          {t("math")}
        </label>
        <textarea
          id={`${id}-math`}
          aria-describedby={`${id}-help`}
          aria-invalid={error ? true : undefined}
          rows={5}
          spellCheck={false}
          maxLength={ELEMENT_TEXT_MAX.math}
          value={element.latex}
          onChange={(event) => onChange({ latex: event.target.value })}
          className={cn(fieldClass, "font-mono text-sm", error && "border-error-600")}
        />
        <p id={`${id}-help`} className="text-sm text-muted">
          {t("mathHelp", { example: "\\frac{a}{b}" })}
        </p>
        {error && (
          <p className="text-sm text-error-700" role="status">
            {t("mathPreviewError", { message: error })}
          </p>
        )}
      </div>
      <Section title={t("style")}>
        <SizeStepper size={element.size} onChange={(size) => onChange({ size })} />
        <AlignButtons value={element.align} onChange={(align) => onChange({ align })} />
      </Section>
    </>
  );
}

function ImageControls({
  hasImage,
  onUpload,
}: {
  hasImage: boolean;
  onUpload: (file: File) => Promise<void>;
}) {
  const t = useTranslations("editor");
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ uploading: boolean; error?: string }>({ uploading: false });

  async function choose(file: File | undefined) {
    if (!file) return;
    if (!(SLIDE_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setState({ uploading: false, error: t("errors.imageType") });
      return;
    }
    if (file.size > SLIDE_IMAGE_MAX_BYTES) {
      setState({ uploading: false, error: t("errors.imageSize", { size: IMAGE_MB }) });
      return;
    }
    setState({ uploading: true });
    try {
      await onUpload(file);
      setState({ uploading: false });
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 413
          ? t("errors.imageSize", { size: IMAGE_MB })
          : error instanceof ApiError && error.status === 415
            ? t("errors.imageType")
            : t("errors.generic");
      setState({ uploading: false, error: message });
    } finally {
      // The same file can be chosen again after an error.
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {t("panel.image")}
      </label>
      <input
        ref={input}
        id={id}
        type="file"
        accept={SLIDE_IMAGE_TYPES.join(",")}
        aria-describedby={`${id}-help`}
        disabled={state.uploading}
        onChange={(event) => void choose(event.target.files?.[0])}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        className={cn(
          buttonClass({ variant: "secondary" }),
          "cursor-pointer self-start peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
          state.uploading && "pointer-events-none opacity-50",
        )}
      >
        {state.uploading
          ? t("panel.imageUploading")
          : hasImage
            ? t("panel.imageReplace")
            : t("panel.imageUpload")}
      </label>
      <p id={`${id}-help`} className="text-sm text-muted">
        {t("panel.imageHelp", { size: IMAGE_MB })}
      </p>
      {state.error && (
        <p className="text-sm text-error-700" role="status">
          {state.error}
        </p>
      )}
    </div>
  );
}
