"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { PendingCohostInvite } from "@moddeck/shared";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { acceptCohostInvite, getPendingCohostInvites } from "@/lib/api/cohost";

/**
 * Co-host invites sent to this KMUTT account by email (F12), above My decks. Accepting opens the
 * co-host page of that session. Shows nothing when there is none, or when the list fails to load.
 */
export function CohostInvites() {
  const t = useTranslations("cohostInvite");
  const router = useRouter();
  const toast = useToast();
  const [invites, setInvites] = useState<PendingCohostInvite[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getPendingCohostInvites().then(
      (list) => active && setInvites(list),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);

  const accept = async (invite: PendingCohostInvite) => {
    setBusy(invite.id);
    try {
      const { sessionId } = await acceptCohostInvite({ inviteId: invite.id });
      router.push(`/host/${sessionId}/qa`);
    } catch {
      toast(t("failed"), { tone: "error" });
      setInvites((current) => current.filter((i) => i.id !== invite.id));
      setBusy(null);
    }
  };

  if (invites.length === 0) return null;
  return (
    <section aria-label={t("listTitle")} className="mx-auto w-full max-w-6xl px-6 pt-6">
      <ul className="flex flex-col gap-2">
        {invites.map((invite) => (
          <li
            key={invite.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-primary-200 bg-primary-50 px-5 py-3"
          >
            <p className="min-w-0 flex-1 text-sm">
              {t("pending", { owner: invite.ownerName, deck: invite.deckTitle })}
            </p>
            <Button disabled={busy !== null} onClick={() => void accept(invite)}>
              {t("accept")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
