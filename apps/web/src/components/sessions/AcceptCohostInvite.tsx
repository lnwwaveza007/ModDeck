"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { buttonClass } from "@/components/ui/Button";
import { Logo } from "@/components/shell/Logo";
import { acceptCohostInvite, cohostLoginUrl } from "@/lib/api/cohost";
import { ApiError } from "@/lib/api/client";

type Problem =
  | "login"
  | "INVITE_INVALID"
  | "INVITE_WRONG_ACCOUNT"
  | "COHOST_EXISTS"
  | "SESSION_ENDED"
  | "generic";

function problemOf(error: unknown): Problem {
  if (!(error instanceof ApiError)) return "generic";
  if (error.status === 401) return "login";
  const known = ["INVITE_INVALID", "INVITE_WRONG_ACCOUNT", "COHOST_EXISTS", "SESSION_ENDED"];
  return known.includes(error.code) ? (error.code as Problem) : "generic";
}

/**
 * The co-host invite link, /cohost/:token (F12). With a KMUTT login it accepts at once and opens the
 * co-host page; without one it sends the TA through KMUTT SSO and back here.
 */
export function AcceptCohostInvite({ token }: { token: string }) {
  const t = useTranslations("cohostInvite");
  const router = useRouter();
  const [problem, setProblem] = useState<Problem | null>(null);
  const sent = useRef(false);

  useEffect(() => {
    // The token works once: React's double effect in development must not spend it twice.
    if (sent.current) return;
    sent.current = true;
    acceptCohostInvite({ token }).then(
      ({ sessionId }) => router.replace(`/host/${sessionId}/qa`),
      (error: unknown) => setProblem(problemOf(error)),
    );
  }, [router, token]);

  return (
    <main className="grid flex-1 place-items-center bg-primary-50 p-6">
      <div className="flex w-full max-w-110 flex-col gap-5 rounded-2xl border border-primary-200 bg-background px-9 py-10 shadow-md">
        <Logo size="lg" />
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        {problem === null ? (
          <p role="status" className="text-muted">
            {t("joining")}
          </p>
        ) : problem === "login" ? (
          <>
            <p className="text-muted">{t("loginFirst")}</p>
            {/* Plain anchor: a full-page redirect to the api, not a Next route. */}
            <a
              href={cohostLoginUrl(token)}
              className={buttonClass({ size: "lg", fullWidth: true })}
            >
              {t("login")}
            </a>
          </>
        ) : (
          <p role="alert" className="text-error-700">
            {t(`errors.${problem}`)}
          </p>
        )}
      </div>
    </main>
  );
}
