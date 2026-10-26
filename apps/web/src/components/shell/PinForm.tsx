"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { buttonClass } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

const PIN_LENGTH = 6;

/** MD-15 landing PIN entry. Digits only; goes to /j/:pin on 6 digits or on "Join". */
export function PinForm() {
  const t = useTranslations("landing");
  const router = useRouter();
  const [pin, setPin] = useState("");
  const complete = pin.length === PIN_LENGTH;

  function join(value: string) {
    router.push(`/j/${value}`);
  }

  function onChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, PIN_LENGTH);
    setPin(digits);
    if (digits.length === PIN_LENGTH) join(digits);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (complete) join(pin);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-7">
      <div className="flex flex-col gap-3">
        <label htmlFor="pin" className="text-sm font-semibold">
          {t("pinLabel")}
        </label>
        <input
          id="pin"
          name="pin"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={PIN_LENGTH}
          placeholder="000000"
          aria-describedby="pin-help"
          value={pin}
          onChange={(event) => onChange(event.target.value)}
          className="h-18 w-full rounded-xl border-2 border-primary-500 bg-background px-5 text-center font-mono text-4xl font-semibold tracking-[0.3em] text-foreground outline-4 outline-primary-100 placeholder:text-neutral-300 focus-visible:outline-primary-200"
        />
        <p id="pin-help" className="text-sm text-muted">
          {t("pinHelp")}
        </p>
      </div>
      <button
        type="submit"
        disabled={!complete}
        className={cn(
          buttonClass({ size: "lg", fullWidth: true }),
          "disabled:bg-neutral-200 disabled:text-neutral-600 disabled:opacity-100",
        )}
      >
        {t("join")}
      </button>
    </form>
  );
}
