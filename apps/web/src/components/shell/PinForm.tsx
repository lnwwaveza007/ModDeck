"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState, type FormEvent } from "react";
import { buttonClass } from "@/components/ui/Button";
import { ApiError } from "@/lib/api/client";
import { getPinInfo } from "@/lib/api/participants";
import { cn } from "@/lib/cn";

const PIN_LENGTH = 6;

/** Why the PIN was not accepted. `invalid` also covers the PIN of a session that has ended. */
export type PinError =
  { kind: "invalid" } | { kind: "tooMany"; seconds: number } | { kind: "network" };

/**
 * MD-15 landing PIN entry. Digits only; checks the PIN on 6 digits or on "Join" and goes to
 * /j/:pin when a session holds it. A wrong PIN is cleared right here with a message, so the
 * student types it again without leaving the page. `initialError` comes from /j/:pin, when a QR
 * code or link carried a PIN that no session holds.
 */
export function PinForm({ initialError }: { initialError?: PinError }) {
  const t = useTranslations("landing");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pin, setPin] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<PinError | null>(initialError ?? null);
  const complete = pin.length === PIN_LENGTH;

  function fail(next: PinError, keepPin: boolean) {
    setChecking(false);
    setError(next);
    if (!keepPin) setPin("");
    input.current?.focus();
  }

  function join(value: string) {
    setChecking(true);
    setError(null);
    getPinInfo(value).then(
      () => router.push(`/j/${value}`),
      (caught: unknown) => {
        const code = caught instanceof ApiError ? caught.code : "NETWORK_ERROR";
        if (code === "NOT_FOUND" || code === "SESSION_ENDED")
          return fail({ kind: "invalid" }, false);
        if (code === "TOO_MANY_ATTEMPTS") {
          const seconds = Number((caught as ApiError).details?.retryAfter) || 60;
          return fail({ kind: "tooMany", seconds }, false);
        }
        // Not the student's typing: keep the PIN so "Join" tries it again.
        if (code === "NETWORK_ERROR") return fail({ kind: "network" }, true);
        // The PIN is right but the session can't take this student (full, removed…):
        // the join page explains that and offers what to do next.
        router.push(`/j/${value}`);
      },
    );
  }

  function onChange(value: string) {
    if (checking) return;
    const digits = value.replace(/\D/g, "").slice(0, PIN_LENGTH);
    setPin(digits);
    if (digits.length > 0) setError(null);
    if (digits.length === PIN_LENGTH) join(digits);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (complete && !checking) join(pin);
  }

  const message =
    error &&
    (error.kind === "tooMany"
      ? t("errors.tooMany", { seconds: error.seconds })
      : t(`errors.${error.kind}`));

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-7">
      <div className="flex flex-col gap-3">
        <label htmlFor="pin" className="text-sm font-semibold">
          {t("pinLabel")}
        </label>
        <input
          ref={input}
          id="pin"
          name="pin"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={PIN_LENGTH}
          placeholder="000000"
          aria-describedby={error ? "pin-error" : "pin-help"}
          aria-invalid={error ? true : undefined}
          readOnly={checking}
          value={pin}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            "h-18 w-full rounded-xl border-2 bg-background px-5 text-center font-mono text-4xl font-semibold tracking-[0.3em] text-foreground outline-4 placeholder:text-neutral-300",
            error
              ? "border-error-600 outline-error-50 focus-visible:outline-error-100"
              : "border-primary-500 outline-primary-100 focus-visible:outline-primary-200",
          )}
        />
        {error ? (
          <p id="pin-error" role="alert" className="text-sm font-medium text-error-700">
            {message}
          </p>
        ) : (
          <p id="pin-help" className="text-sm text-muted">
            {t("pinHelp")}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={!complete || checking}
        className={cn(
          buttonClass({ size: "lg", fullWidth: true }),
          "disabled:bg-neutral-200 disabled:text-neutral-600 disabled:opacity-100",
        )}
      >
        {checking ? t("checking") : t("join")}
      </button>
    </form>
  );
}
