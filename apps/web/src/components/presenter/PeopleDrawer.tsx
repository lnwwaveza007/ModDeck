"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  NICKNAME_MAX,
  nicknameKey,
  nicknameProblem,
  normalizeNickname,
  type NicknameProblem,
  type ParticipantRow,
} from "@moddeck/shared";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import type { ParticipantsControls, ParticipantsState } from "@/lib/live/use-participants";

type RenameError = NicknameProblem | "TAKEN" | "NOT_A_GUEST" | "generic";

function renameError(error: unknown): RenameError {
  if (!(error instanceof ApiError)) return "generic";
  if (error.code === "NICKNAME_TAKEN") return "TAKEN";
  if (error.code === "NOT_A_GUEST") return "NOT_A_GUEST";
  if (error.code === "NICKNAME_INVALID") {
    const fields = error.details?.fields as { nickname?: NicknameProblem } | undefined;
    return fields?.nickname ?? "generic";
  }
  return "generic";
}

/**
 * MD-15 H08 People drawer (F13, MD-5 §2.5): who joined, who is online, rename a guest, remove
 * anyone. KMUTT students show their KMUTT name, so they cannot be renamed.
 */
export function PeopleDrawer({
  state,
  controls,
  ended,
  onClose,
}: {
  state: ParticipantsState;
  controls: ParticipantsControls;
  ended: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("presenter.people");
  const tc = useTranslations("common");
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ParticipantRow | null>(null);
  const confirmOpen = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
    confirmOpen.current = removing !== null;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      // The remove dialog on top takes Escape for itself.
      if (event.key === "Escape" && !confirmOpen.current) onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      opener?.focus();
    };
  }, []);

  const rows = state.rows ?? [];
  const needle = nicknameKey(query);
  const shown = needle ? rows.filter((row) => nicknameKey(row.nickname).includes(needle)) : rows;

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <div aria-hidden="true" className="fixed inset-0 bg-neutral-900/45" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex h-full w-full max-w-md flex-col bg-background shadow-md focus-visible:outline-none"
      >
        <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-4">
          <div>
            <h2 id={titleId} className="text-xl font-bold">
              {t("title")}
            </h2>
            <p className="text-sm text-muted">
              {t("summary", { online: state.online, total: rows.length })}
            </p>
          </div>
          <Button variant="ghost" onClick={onClose} aria-label={tc("close")}>
            ✕
          </Button>
        </div>

        <div className="border-b border-neutral-200 px-5 py-3">
          <label className="sr-only" htmlFor={`${titleId}-search`}>
            {t("search")}
          </label>
          <input
            id={`${titleId}-search`}
            type="search"
            value={query}
            placeholder={t("search")}
            onChange={(event) => setQuery(event.target.value)}
            className="h-11 w-full rounded-md border border-border bg-background px-3 text-base placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
          {state.failed && !state.rows ? (
            <div className="flex flex-col items-start gap-2 py-6 text-sm">
              <p role="alert">{t("loadFailed")}</p>
              <Button variant="secondary" onClick={controls.reload}>
                {t("retry")}
              </Button>
            </div>
          ) : !state.rows ? (
            <p role="status" className="py-6 text-sm text-muted">
              {t("loading")}
            </p>
          ) : shown.length === 0 ? (
            <p className="py-6 text-sm text-muted">
              {rows.length === 0 ? t("empty") : t("noMatch", { query: query.trim() })}
            </p>
          ) : (
            <ul aria-label={t("listLabel")} className="divide-y divide-neutral-200">
              {shown.map((row) =>
                renaming === row.id ? (
                  <RenameRow
                    key={row.id}
                    row={row}
                    onSave={(nickname) => controls.rename(row.id, nickname)}
                    onDone={() => setRenaming(null)}
                  />
                ) : (
                  <PersonRow
                    key={row.id}
                    row={row}
                    ended={ended}
                    onRename={() => setRenaming(row.id)}
                    onRemove={() => setRemoving(row)}
                  />
                ),
              )}
            </ul>
          )}
        </div>
      </div>

      {removing && (
        <RemoveDialog
          row={removing}
          onRemove={() => controls.remove(removing.id)}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

function PersonRow({
  row,
  ended,
  onRename,
  onRemove,
}: {
  row: ParticipantRow;
  ended: boolean;
  onRename: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("presenter.people");
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span
        aria-hidden="true"
        className={cn(
          "size-2.5 shrink-0 rounded-full",
          row.online ? "bg-success-600" : "bg-neutral-300",
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-semibold">{row.nickname}</span>
        <span className="text-xs text-muted">{t(row.online ? "online" : "offline")}</span>
      </div>
      <Badge tone={row.loginType === "sso" ? "primary" : "neutral"}>
        {t(row.loginType === "sso" ? "kmutt" : "guest")}
      </Badge>
      {!ended && (
        <div className="flex shrink-0">
          {row.loginType === "guest" && (
            <Button
              variant="ghost"
              onClick={onRename}
              aria-label={t("renameLabel", { name: row.nickname })}
            >
              {t("rename")}
            </Button>
          )}
          <Button
            variant="ghost"
            className="text-error-700"
            onClick={onRemove}
            aria-label={t("removeLabel", { name: row.nickname })}
          >
            {t("remove")}
          </Button>
        </div>
      )}
    </li>
  );
}

function RenameRow({
  row,
  onSave,
  onDone,
}: {
  row: ParticipantRow;
  onSave: (nickname: string) => Promise<void>;
  onDone: () => void;
}) {
  const t = useTranslations("presenter.people");
  const tj = useTranslations("join.nickname.errors");
  const inputId = useId();
  const [value, setValue] = useState(row.nickname);
  const [error, setError] = useState<RenameError | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const nickname = normalizeNickname(value);
    if (nickname === row.nickname) return onDone();
    const problem = nicknameProblem(nickname);
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    try {
      await onSave(nickname);
      onDone();
    } catch (err) {
      setError(renameError(err));
      setSaving(false);
    }
  };

  const message =
    error === null
      ? null
      : error === "generic" || error === "NOT_A_GUEST"
        ? t(`renameErrors.${error}`)
        : tj(error);

  return (
    <li className="py-2.5">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <label htmlFor={inputId} className="text-sm font-semibold">
          {t("newName", { name: row.nickname })}
        </label>
        <input
          id={inputId}
          autoFocus
          value={value}
          maxLength={NICKNAME_MAX * 4}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              onDone();
            }
          }}
          className={cn(
            "h-11 rounded-md border bg-background px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
            error ? "border-error-600" : "border-border",
          )}
        />
        {message && (
          <p id={`${inputId}-error`} role="alert" className="text-sm text-error-700">
            {message}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? t("saving") : t("save")}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            {t("cancel")}
          </Button>
        </div>
      </form>
    </li>
  );
}

function RemoveDialog({
  row,
  onRemove,
  onClose,
}: {
  row: ParticipantRow;
  onRemove: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations("presenter.people");
  const tc = useTranslations("common");
  const [removing, setRemoving] = useState(false);
  const [failed, setFailed] = useState(false);

  const confirm = async () => {
    setRemoving(true);
    setFailed(false);
    try {
      await onRemove();
      onClose();
    } catch {
      setFailed(true);
      setRemoving(false);
    }
  };

  return (
    <Dialog
      title={t("removeTitle", { name: row.nickname })}
      closeLabel={tc("close")}
      onClose={onClose}
    >
      <div className="flex flex-col gap-3 text-sm">
        <p>{t("removeBody")}</p>
        <p className="text-muted">{t("removeAnswers")}</p>
        {failed && (
          <p role="alert" className="text-error-700">
            {t("removeFailed")}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button variant="danger" disabled={removing} onClick={() => void confirm()}>
          {removing ? t("removing") : t("removeConfirm")}
        </Button>
      </div>
    </Dialog>
  );
}
