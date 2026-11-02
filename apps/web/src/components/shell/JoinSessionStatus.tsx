"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api/client";

export function JoinSessionStatus({ pin }: { pin: string }) {
  const [state, setState] = useState<"checking" | "ended" | "ready" | "invalid">("checking");
  useEffect(() => {
    apiFetch<{ status: string }>(`/pins/${pin}`).then(
      ({ status }) => setState(status === "ended" ? "ended" : "ready"),
      (error: unknown) =>
        setState(error instanceof ApiError && error.status === 410 ? "ended" : "invalid"),
    );
  }, [pin]);
  if (state === "checking") return <p className="m-auto">Checking session…</p>;
  if (state === "ended")
    return (
      <section className="m-auto max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
        <div className="text-4xl">✓</div>
        <h1 className="mt-4 text-2xl font-bold">Session ended</h1>
        <p className="mt-2 text-slate-600">This session has ended. Thanks for joining.</p>
      </section>
    );
  if (state === "invalid")
    return (
      <section className="m-auto max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-bold">No session found</h1>
        <p className="mt-2 text-slate-600">Check the PIN on the screen and try again.</p>
      </section>
    );
  return (
    <section className="m-auto max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
      <h1 className="text-2xl font-bold">Join session {pin}</h1>
      <p className="mt-2 text-slate-600">Participant sign-in is not available yet.</p>
    </section>
  );
}
