"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { MeView, UserSummary } from "@moddeck/shared";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { getMe, searchUsers, startImpersonating, stopImpersonating } from "@/lib/api/admin";
import { hardNavigate } from "@/lib/hard-navigate";

/**
 * Top-right admin tool. An admin (ADMIN_EMAILS on the api) gets an "Impersonate" button that
 * picks a user to act as. While impersonating, an amber chip names that user and stops it.
 * Everyone else sees nothing.
 */
export function ImpersonateControl() {
  const t = useTranslations("impersonate");
  const [me, setMe] = useState<MeView | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    // 401 (signed out) and network errors both leave the control hidden.
    getMe()
      .then((view) => live && setMe(view))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  if (!me) return null;

  const stop = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await stopImpersonating();
      hardNavigate("/decks");
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  if (me.impersonator) {
    return (
      <div
        role="status"
        className="inline-flex h-11 items-center gap-2 rounded-md bg-warning-50 pr-1 pl-3 text-sm text-warning-800"
      >
        <span className="max-w-56 truncate">
          {t.rich("viewingAs", {
            name: me.displayName,
            strong: (chunks) => <strong className="font-semibold">{chunks}</strong>,
          })}
        </span>
        <Button variant="secondary" className="h-9 px-3" onClick={stop} disabled={busy}>
          {failed ? t("retryStop") : t("stop")}
        </Button>
      </div>
    );
  }

  if (!me.isAdmin) return null;

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="9" cy="8" r="4" />
          <path d="M2 21a7 7 0 0 1 14 0M16 11h6M19 8v6" />
        </svg>
        {t("open")}
      </Button>
      {open && <ImpersonateDialog selfId={me.id} onClose={() => setOpen(false)} />}
    </>
  );
}

function ImpersonateDialog({ selfId, onClose }: { selfId: string; onClose: () => void }) {
  const t = useTranslations("impersonate");
  const tc = useTranslations("common");
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [error, setError] = useState<"search" | "start" | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchUsers(query, controller.signal)
        .then((found) => {
          setUsers(found.filter((user) => user.id !== selfId));
          setError(null);
        })
        .catch((caught: unknown) => {
          if (!(caught instanceof DOMException && caught.name === "AbortError")) setError("search");
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, selfId]);

  const impersonate = async (user: UserSummary) => {
    setPending(user.id);
    setError(null);
    try {
      await startImpersonating(user.id);
      hardNavigate("/decks");
    } catch {
      setError("start");
      setPending(null);
    }
  };

  return (
    <Dialog title={t("title")} closeLabel={tc("close")} onClose={onClose}>
      <p className="text-sm text-muted">{t("description")}</p>
      <Input
        label={t("searchLabel")}
        type="search"
        value={query}
        placeholder={t("searchPlaceholder")}
        onChange={(event) => setQuery(event.target.value)}
        autoComplete="off"
      />
      {error && (
        <p role="alert" className="text-sm text-error-700">
          {t(error === "search" ? "searchError" : "startError")}
        </p>
      )}
      {users === null ? (
        !error && <p className="text-sm text-muted">{t("loading")}</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-muted">{t("noUsers")}</p>
      ) : (
        <ul aria-label={t("results")} className="-mx-2 flex max-h-80 flex-col overflow-y-auto">
          {users.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => impersonate(user)}
                className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2.5 text-left hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold">{user.displayName}</span>
                  <span className="truncate text-sm text-muted">{user.email}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-primary-700">
                  {pending === user.id ? t("starting") : t("actAs")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
