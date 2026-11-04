"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  MAX_PARTICIPANTS,
  NICKNAME_MAX,
  graphemeLength,
  nicknameProblem,
  normalizeNickname,
  type NicknameProblem,
  type PinInfo,
} from "@moddeck/shared";
import { Button, buttonClass } from "@/components/ui/Button";
import { ApiError } from "@/lib/api/client";
import { getPinInfo, joinSession, kmuttLoginUrl } from "@/lib/api/participants";

type Blocker = "invalid" | "ended" | "full" | "tooMany" | "removed" | "network";

type View =
  | { kind: "checking" }
  | { kind: "blocked"; reason: Blocker; retryAfter?: number }
  | { kind: "identity" }
  | { kind: "nickname" }
  | { kind: "joining" };

// ?sso_error codes with their own message; the rest get the default one.
const SSO_REASONS = ["access_denied", "sso_unavailable"] as const;

// Typed text survives a drop or a reload (MD-5 rule 6).
const DRAFT_KEY = "moddeck:nickname";

function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveDraft(value: string) {
  try {
    localStorage.setItem(DRAFT_KEY, value);
  } catch {
    /* private mode: the draft just isn't kept */
  }
}

/** "482914" → "482 914", as on the projector. */
const spacedPin = (pin: string) => `${pin.slice(0, 3)} ${pin.slice(3)}`;

function blockerFor(error: unknown): { reason: Blocker; retryAfter?: number } | null {
  if (!(error instanceof ApiError)) return { reason: "network" };
  switch (error.code) {
    case "NOT_FOUND":
      return { reason: "invalid" };
    case "SESSION_ENDED":
      return { reason: "ended" };
    case "SESSION_FULL":
      return { reason: "full" };
    case "PARTICIPANT_REMOVED":
      return { reason: "removed" };
    case "TOO_MANY_ATTEMPTS":
      return { reason: "tooMany", retryAfter: Number(error.details?.retryAfter) || 60 };
    case "NETWORK_ERROR":
      return { reason: "network" };
    default:
      return null;
  }
}

/**
 * Student join at /j/:pin (MD-15 S03 identity, S04 nickname, S05 full, E01 joining,
 * E04 SSO error). `sso` is set when KMUTT SSO sent the student back here.
 */
export function JoinFlow({
  pin,
  sso = false,
  ssoError,
}: {
  pin: string;
  sso?: boolean;
  ssoError?: string;
}) {
  const t = useTranslations("join");
  const router = useRouter();
  const [info, setInfo] = useState<PinInfo | null>(null);
  const [view, setView] = useState<View>({ kind: "checking" });
  const [attempt, setAttempt] = useState(0);
  const [loginError, setLoginError] = useState(ssoError ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [nicknameError, setNicknameError] = useState<NicknameProblem | "TAKEN" | null>(null);

  function enter(sessionId: string) {
    setView({ kind: "joining" });
    router.replace(`/s/${sessionId}`);
  }

  function failJoin(error: unknown, from: "identity" | "nickname") {
    const blocker = blockerFor(error);
    if (blocker) return setView({ kind: "blocked", ...blocker });
    const code = error instanceof ApiError ? error.code : "";
    if (code === "NICKNAME_TAKEN") setNicknameError("TAKEN");
    else if (code === "NICKNAME_INVALID") {
      setNicknameError(
        (error as ApiError).details?.fields
          ? ((error as ApiError).details!.fields as { nickname: NicknameProblem }).nickname
          : "INVALID_CHARS",
      );
    } else if (code === "LOGIN_REQUIRED") {
      setInfo((current) => current && { ...current, requireLogin: true });
      setNotice(t("loginRequired"));
      return setView({ kind: "identity" });
    } else setNotice(t("errors.generic"));
    setView({ kind: from });
  }

  function joinWithKmutt(cameBackFromSso: boolean) {
    setNotice(null);
    setView({ kind: "joining" });
    joinSession(pin).then(
      (joined) => enter(joined.sessionId),
      (error: unknown) => {
        // No KMUTT login yet: go to SSO. Coming back without one means the
        // login did not stick, so offer the guest option instead of looping.
        if (error instanceof ApiError && error.status === 401) {
          if (!cameBackFromSso) return window.location.assign(kmuttLoginUrl(pin));
          setLoginError("login_failed");
          return setView({ kind: "identity" });
        }
        failJoin(error, "identity");
      },
    );
  }

  useEffect(() => {
    let active = true;
    getPinInfo(pin).then(
      (value) => {
        if (!active) return;
        setInfo(value);
        if (value.joined) return enter(value.joined.sessionId);
        if (sso && !ssoError) return joinWithKmutt(true);
        setView({ kind: "identity" });
      },
      (error: unknown) => {
        if (active) setView({ kind: "blocked", ...(blockerFor(error) ?? { reason: "network" }) });
      },
    );
    return () => {
      active = false;
    };
    // Runs once per PIN and per "Try again"; the handlers only read the latest props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, attempt]);

  function retry() {
    setView({ kind: "checking" });
    setAttempt((n) => n + 1);
  }

  function chooseGuest() {
    setNotice(null);
    setNickname((current) => current || readDraft());
    setView({ kind: "nickname" });
  }

  function submitNickname(event: FormEvent) {
    event.preventDefault();
    const value = normalizeNickname(nickname);
    const problem = nicknameProblem(value);
    if (problem) return setNicknameError(problem);
    setNicknameError(null);
    setNotice(null);
    setView({ kind: "joining" });
    joinSession(pin, value).then(
      (joined) => enter(joined.sessionId),
      (error: unknown) => failJoin(error, "nickname"),
    );
  }

  if (view.kind === "checking") return <Status>{t("status.checking")}</Status>;
  if (view.kind === "joining") {
    return (
      <Status>
        <span
          aria-hidden="true"
          className="size-12 animate-spin rounded-full border-5 border-primary-100 border-t-primary-500 motion-reduce:animate-none"
        />
        <span className="text-xl font-semibold text-foreground">{t("joining")}</span>
        {info && <span>{info.title}</span>}
      </Status>
    );
  }
  if (view.kind === "blocked") {
    return (
      <BlockedView reason={view.reason} retryAfter={view.retryAfter} info={info} onRetry={retry} />
    );
  }

  if (view.kind === "nickname") {
    // Counts what the server keeps: no extra spaces, Thai marks folded into their letter.
    const length = graphemeLength(normalizeNickname(nickname));
    return (
      <form
        onSubmit={submitNickname}
        noValidate
        className="flex flex-1 flex-col gap-6 px-5 pt-4 pb-6"
      >
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold">{t("nickname.title")}</h1>
          <p className="text-muted">{t("nickname.body")}</p>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="nickname" className="text-sm font-semibold">
            {t("nickname.label")}
          </label>
          <input
            id="nickname"
            name="nickname"
            autoComplete="nickname"
            autoFocus
            value={nickname}
            aria-invalid={nicknameError ? true : undefined}
            aria-describedby={nicknameError ? "nickname-help nickname-error" : "nickname-help"}
            onChange={(event) => {
              setNickname(event.target.value);
              setNicknameError(null);
              saveDraft(event.target.value);
            }}
            className={`h-14 rounded-lg border-2 bg-background px-4 text-lg focus-visible:outline-4 focus-visible:outline-primary-100 ${
              nicknameError ? "border-error-600" : "border-primary-500"
            }`}
          />
          <div className="flex justify-between gap-3 text-sm text-muted">
            <span id="nickname-help">{t("nickname.help")}</span>
            <span aria-hidden="true">
              {length}/{NICKNAME_MAX}
            </span>
          </div>
          {nicknameError && (
            <p id="nickname-error" role="alert" className="text-sm text-error-700">
              {t(`nickname.errors.${nicknameError}`)}
            </p>
          )}
        </div>
        {notice && <Notice>{notice}</Notice>}
        <Button type="submit" size="lg" fullWidth>
          {t("nickname.submit")}
        </Button>
        <Button variant="ghost" onClick={() => setView({ kind: "identity" })}>
          {t("nickname.back")}
        </Button>
      </form>
    );
  }

  // Identity: MD-15 S03, with the E04 message when KMUTT sign-in failed.
  const guestAllowed = !info?.requireLogin;
  return (
    <div className="flex flex-1 flex-col gap-8 px-5 pt-4 pb-6">
      {info && (
        <section className="flex flex-col gap-4 rounded-2xl border border-primary-200 bg-primary-50 p-5">
          <span className="self-start rounded-full bg-background px-2.5 py-0.5 font-mono text-sm font-semibold text-primary-700">
            {t("pin", { pin: spacedPin(pin) })}
          </span>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold">{info.title}</h1>
            <p className="text-neutral-700">{info.hostName}</p>
          </div>
          <p className="flex items-center gap-2 text-sm text-neutral-700">
            <span aria-hidden="true" className="size-2 rounded-full bg-success-600" />
            {t("liveCount", { count: info.participantCount })}
          </p>
        </section>
      )}

      {loginError && (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-lg border border-error-100 bg-error-50 p-4"
        >
          <p className="font-semibold text-error-800">{t("sso.title")}</p>
          <p className="text-sm text-error-800">
            {t(`sso.reasons.${SSO_REASONS.find((r) => r === loginError) ?? "default"}`)}
            {guestAllowed && ` ${t("sso.guestOffer")}`}
          </p>
        </div>
      )}
      {notice && <Notice>{notice}</Notice>}

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("joinAs")}</h2>
        <Button size="lg" fullWidth onClick={() => joinWithKmutt(false)}>
          <ShieldIcon />
          {loginError ? t("sso.retry") : t("kmutt")}
        </Button>
        {guestAllowed ? (
          <Button variant="secondary" size="lg" fullWidth onClick={chooseGuest}>
            <PersonIcon />
            {t("guest")}
          </Button>
        ) : (
          <p className="text-sm text-muted">{t("loginRequired")}</p>
        )}
      </div>

      <div className="flex gap-3 rounded-xl border border-neutral-200 bg-surface p-4">
        <LockIcon />
        <p className="text-sm text-neutral-700">{t("privacy")}</p>
      </div>
    </div>
  );
}

function BlockedView({
  reason,
  retryAfter,
  info,
  onRetry,
}: {
  reason: Blocker;
  retryAfter?: number;
  info: PinInfo | null;
  onRetry: () => void;
}) {
  const t = useTranslations("join");
  const otherPin = (
    <Link href="/" className={buttonClass({ variant: "secondary", size: "lg", fullWidth: true })}>
      {t("otherPin")}
    </Link>
  );
  const retryButton = (
    <Button size="lg" fullWidth onClick={onRetry}>
      {t("retry")}
    </Button>
  );
  const content: Record<Blocker, { title: string; body: string; actions: ReactNode }> = {
    invalid: {
      title: t("status.invalidTitle"),
      body: t("status.invalidBody"),
      actions: (
        <Link href="/" className={buttonClass({ size: "lg", fullWidth: true })}>
          {t("retry")}
        </Link>
      ),
    },
    ended: { title: t("status.endedTitle"), body: t("status.endedBody"), actions: otherPin },
    full: {
      title: t("full.title"),
      body: t("full.body", { title: info?.title ?? t("full.thisClass"), max: MAX_PARTICIPANTS }),
      actions: (
        <>
          {retryButton}
          {otherPin}
        </>
      ),
    },
    tooMany: {
      title: t("tooMany.title"),
      body: t("tooMany.body", { seconds: retryAfter ?? 60 }),
      actions: retryButton,
    },
    removed: { title: t("removed.title"), body: t("removed.body"), actions: otherPin },
    network: { title: t("network.title"), body: t("network.body"), actions: retryButton },
  };
  const { title, body, actions } = content[reason];
  return (
    <section className="flex flex-1 flex-col justify-center gap-6 px-5 pb-10">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-neutral-700">{body}</p>
      </div>
      <div className="flex flex-col gap-3">{actions}</div>
    </section>
  );
}

function Status({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="flex flex-1 flex-col items-center justify-center gap-3 px-5 pb-10 text-center text-muted"
    >
      {children}
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-warning-100 bg-warning-50 p-3 text-sm text-warning-800"
    >
      {children}
    </p>
  );
}

const iconProps = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function ShieldIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg {...iconProps} width={22} height={22} className="mt-0.5 shrink-0 text-neutral-700">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
