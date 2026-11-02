"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch, ApiError } from "@/lib/api/client";

export function JoinSessionStatus({ pin }: { pin: string }) {
  const t = useTranslations("join");
  const [state, setState] = useState<"checking" | "ended" | "ready" | "invalid">("checking");
  useEffect(() => {
    apiFetch<{ status: string }>(`/pins/${pin}`).then(
      ({ status }) => setState(status === "ended" ? "ended" : "ready"),
      (error: unknown) =>
        setState(error instanceof ApiError && error.status === 410 ? "ended" : "invalid"),
    );
  }, [pin]);
  if (state === "checking") return <p className="m-auto">{t("status.checking")}</p>;
  if (state === "ended")
    return (
      <section className="m-auto max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
        <div className="text-4xl">✓</div>
        <h1 className="mt-4 text-2xl font-bold">{t("status.endedTitle")}</h1>
        <p className="mt-2 text-slate-600">{t("status.endedBody")}</p>
      </section>
    );
  if (state === "invalid")
    return (
      <section className="m-auto max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-bold">{t("status.invalidTitle")}</h1>
        <p className="mt-2 text-slate-600">{t("status.invalidBody")}</p>
      </section>
    );
  return (
    <section className="m-auto max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
      <h1 className="text-2xl font-bold">{t("status.joinTitle", { pin })}</h1>
      <p className="mt-2 text-slate-600">{t("status.signInUnavailable")}</p>
    </section>
  );
}
