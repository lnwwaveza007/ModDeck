"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { KMUTT_EMAIL, type SessionControlView } from "@moddeck/shared";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { ApiError } from "@/lib/api/client";
import type { SessionControlActions } from "@/lib/live/use-session-control";

type InviteError = "email" | "self" | "COHOST_EXISTS" | "SESSION_ENDED" | "generic";

function inviteError(error: unknown): InviteError {
  if (!(error instanceof ApiError)) return "generic";
  if (error.code === "INVALID_PAYLOAD") return error.details?.field === "email" ? "self" : "email";
  if (error.code === "COHOST_EXISTS" || error.code === "SESSION_ENDED") return error.code;
  return "generic";
}

/**
 * MD-15 H08 co-host invite (F12): the owner invites one TA by KMUTT email or by a one-time link,
 * sees who accepted, and can cancel the invite or remove the co-host. The link holds a token the
 * api shows only once, so it stays on screen only until the dialog closes.
 */
export function CohostDialog({
  control,
  actions,
  ended,
  onClose,
}: {
  control: SessionControlView;
  actions: SessionControlActions;
  ended: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("presenter.cohost");
  const tc = useTranslations("common");
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<InviteError | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(inviteError(caught));
    } finally {
      setBusy(false);
    }
  };

  const invite = (byEmail: boolean) =>
    run(async () => {
      setCopied(false);
      setLink(await actions.invite(byEmail ? email.trim() : undefined));
    });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!KMUTT_EMAIL.test(email.trim())) return setError("email");
    void invite(true);
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const { cohost, invite: pending } = control;

  return (
    <Dialog title={t("title")} closeLabel={tc("close")} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t("intro")}</p>

        {cohost ? (
          <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4">
            <p className="text-sm">
              <b>{cohost.displayName}</b> <span className="text-muted">· {cohost.email}</span>
            </p>
            <p className="text-sm text-muted">
              {control.controllerId === cohost.userId ? t("cohostInControl") : t("cohostJoined")}
            </p>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void run(actions.removeCohost)}
            >
              {t("remove")}
            </Button>
          </section>
        ) : (
          <>
            {pending && (
              <section className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-4 text-sm">
                <p>
                  {pending.email ? t("waitingEmail", { email: pending.email }) : t("waitingLink")}
                </p>
                {link && (
                  <div className="flex gap-2">
                    <input
                      readOnly
                      aria-label={t("linkLabel")}
                      value={link}
                      onFocus={(event) => event.currentTarget.select()}
                      className="h-10 min-w-0 flex-1 rounded-md border border-border bg-neutral-50 px-3 font-mono text-xs"
                    />
                    <Button variant="secondary" onClick={() => void copy()}>
                      {copied ? t("copied") : t("copy")}
                    </Button>
                  </div>
                )}
                {link && <p className="text-xs text-muted">{t("linkOnce")}</p>}
                <Button
                  variant="ghost"
                  className="self-start"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await actions.cancelInvite();
                      setLink(null);
                    })
                  }
                >
                  {t("cancelInvite")}
                </Button>
              </section>
            )}

            {!ended && (
              <>
                <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
                  <Input
                    label={t("emailLabel")}
                    hint={t("emailHint")}
                    type="email"
                    autoComplete="off"
                    value={email}
                    error={error === "email" || error === "self" ? t(`errors.${error}`) : undefined}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                  <Button type="submit" disabled={busy || !email.trim()}>
                    {t("inviteEmail")}
                  </Button>
                </form>
                <div className="flex items-center gap-3 text-xs text-muted">
                  <span className="h-px flex-1 bg-neutral-200" />
                  {t("or")}
                  <span className="h-px flex-1 bg-neutral-200" />
                </div>
                <Button variant="secondary" disabled={busy} onClick={() => void invite(false)}>
                  {t("createLink")}
                </Button>
                <p className="text-xs text-muted">{t("replaceNote")}</p>
              </>
            )}
          </>
        )}

        {error && error !== "email" && error !== "self" && (
          <p role="alert" className="text-sm text-error-700">
            {t(`errors.${error}`)}
          </p>
        )}
      </div>
    </Dialog>
  );
}
