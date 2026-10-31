"use client";

import { useTranslations } from "next-intl";
import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CODE_LANGUAGES,
  DEFAULT_CODE_LANGUAGE,
  SLIDE_CONTENT_MAX,
  SLIDE_IMAGE_MAX_BYTES,
  SLIDE_IMAGE_TYPES,
  isActivityKind,
  isCodeLanguage,
  type SlideDto,
  type SlidePatchBody,
} from "@moddeck/shared";
import { buttonClass } from "@/components/ui/Button";
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { renderMath } from "@/lib/render/math";

const IMAGE_MB = SLIDE_IMAGE_MAX_BYTES / (1024 * 1024);

const fieldClass =
  "w-full rounded-md border border-border bg-background p-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

function Field({
  label,
  help,
  error,
  children,
  htmlFor,
  helpId,
}: {
  label: string;
  help?: string;
  error?: string;
  children: ReactNode;
  htmlFor: string;
  helpId: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-semibold">
        {label}
      </label>
      {children}
      {help && (
        <p id={helpId} className="text-sm text-muted">
          {help}
        </p>
      )}
      {error && (
        <p className="text-sm text-error-700" role="status">
          {error}
        </p>
      )}
    </div>
  );
}

/** MD-15 H02 side panel: the fields of the selected slide. Every change autosaves. */
export function SlidePanel({
  slide,
  onEdit,
  onUploadImage,
}: {
  slide: SlideDto;
  onEdit: (fields: SlidePatchBody) => void;
  onUploadImage: (file: File) => Promise<void>;
}) {
  const t = useTranslations("editor");
  const id = useId();
  const content = slide.content ?? "";
  const language = slide.language ?? DEFAULT_CODE_LANGUAGE;

  // Same check the canvas runs, so the message shows under the field as the host types.
  const mathError = useMemo(() => {
    if (slide.kind !== "math") return undefined;
    const result = renderMath(content);
    return result.ok ? undefined : result.error;
  }, [slide.kind, content]);

  return (
    <section aria-label={t("panel.editSlide")} className="flex flex-col gap-4">
      <h2 className="text-lg font-bold">
        {isActivityKind(slide.kind) ? t("panel.editActivity") : t("panel.editSlide")}
      </h2>

      {slide.kind === "text" && (
        <Field
          label={t("panel.text")}
          help={t("panel.textHelp")}
          htmlFor={`${id}-text`}
          helpId={`${id}-help`}
        >
          <textarea
            id={`${id}-text`}
            aria-describedby={`${id}-help`}
            rows={10}
            maxLength={SLIDE_CONTENT_MAX.text}
            value={content}
            onChange={(event) => onEdit({ content: event.target.value })}
            className={fieldClass}
          />
        </Field>
      )}

      {slide.kind === "code" && (
        <>
          <Field label={t("panel.language")} htmlFor={`${id}-lang`} helpId={`${id}-lang-help`}>
            <select
              id={`${id}-lang`}
              value={language}
              onChange={(event) => {
                if (isCodeLanguage(event.target.value)) onEdit({ language: event.target.value });
              }}
              className={cn(fieldClass, "h-11 py-0")}
            >
              {CODE_LANGUAGES.map((name) => (
                <option key={name} value={name}>
                  {t(`languages.${name}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("panel.code")} htmlFor={`${id}-code`} helpId={`${id}-code-help`}>
            <textarea
              id={`${id}-code`}
              rows={14}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              wrap="off"
              maxLength={SLIDE_CONTENT_MAX.code}
              value={content}
              onChange={(event) => onEdit({ content: event.target.value })}
              className={cn(fieldClass, "font-mono text-sm leading-[1.5] whitespace-pre")}
            />
          </Field>
        </>
      )}

      {slide.kind === "math" && (
        <Field
          label={t("panel.math")}
          help={t("panel.mathHelp", { example: "\\frac{a}{b}" })}
          error={mathError ? t("panel.mathPreviewError", { message: mathError }) : undefined}
          htmlFor={`${id}-math`}
          helpId={`${id}-help`}
        >
          <textarea
            id={`${id}-math`}
            aria-describedby={`${id}-help`}
            aria-invalid={mathError ? true : undefined}
            rows={6}
            spellCheck={false}
            maxLength={SLIDE_CONTENT_MAX.math}
            value={content}
            onChange={(event) => onEdit({ content: event.target.value })}
            className={cn(fieldClass, "font-mono text-sm", mathError && "border-error-600")}
          />
        </Field>
      )}

      {slide.kind === "image" && (
        <ImageField
          hasImage={slide.imageRef !== null}
          onUpload={onUploadImage}
          label={t("panel.image")}
        />
      )}

      {isActivityKind(slide.kind) && (
        <p className="rounded-md bg-neutral-100 p-3 text-sm text-muted">
          {t("panel.activityComingSoon")}
        </p>
      )}
    </section>
  );
}

function ImageField({
  hasImage,
  onUpload,
  label,
}: {
  hasImage: boolean;
  onUpload: (file: File) => Promise<void>;
  label: string;
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
        {label}
      </label>
      <input
        ref={input}
        id={id}
        type="file"
        accept={SLIDE_IMAGE_TYPES.join(",")}
        aria-describedby={`${id}-help`}
        disabled={state.uploading}
        onChange={(event) => void choose(event.target.files?.[0])}
        className="sr-only peer"
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
