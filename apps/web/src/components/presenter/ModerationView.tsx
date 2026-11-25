"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { SessionControlView } from "@moddeck/shared";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { Button, buttonClass } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { SessionHeader } from "@/components/shell/SessionHeader";
import { cn } from "@/lib/cn";
import type { LiveSessionControls, LiveSessionState } from "@/lib/live/use-live-session";
import type { ParticipantsControls, ParticipantsState } from "@/lib/live/use-participants";
import type { SessionControlActions } from "@/lib/live/use-session-control";
import { PeopleDrawer } from "./PeopleDrawer";
import { QaPanel } from "./QaPanel";

/**
 * MD-15 H11 co-host page (F12): Q&A moderation and the participant list, on the co-host's own
 * device. The owner sees it too while the co-host runs presenter control. The banner says who has
 * control and offers to take it: "Take over" for the co-host, "Take back" for the owner.
 */
export function ModerationView({
  sessionId,
  state,
  controls,
  people,
  peopleControls,
  control,
  inControl,
  actions,
  onError,
}: {
  sessionId: string;
  state: LiveSessionState;
  controls: LiveSessionControls;
  people: ParticipantsState;
  peopleControls: ParticipantsControls;
  control: SessionControlView;
  inControl: boolean;
  actions: SessionControlActions;
  onError: (error: unknown) => void;
}) {
  const t = useTranslations("presenter");
  const tc = useTranslations("common");
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [taking, setTaking] = useState(false);
  const { view } = state;
  const isOwner = control.role === "owner";
  const controller = control.controllerId === control.owner.userId ? control.owner : control.cohost;

  const take = async () => {
    setTaking(true);
    try {
      await actions.take();
      setConfirming(false);
    } catch (error) {
      onError(error);
    } finally {
      setTaking(false);
    }
  };

  const total = people.rows?.length ?? view?.participantCount ?? 0;

  return (
    <div className="flex min-h-screen flex-col bg-neutral-100">
      <SessionHeader
        leading="live"
        title={view?.title ?? ""}
        badge={<Badge tone="primary">{isOwner ? t("cohost.ownerBadge") : t("cohost.badge")}</Badge>}
      >
        <Button variant="secondary" aria-haspopup="dialog" onClick={() => setPeopleOpen(true)}>
          {people.rows
            ? t("people.button", { online: people.online, total })
            : t("participants", { count: total })}
        </Button>
        <span
          role="status"
          className={cn(
            "text-sm",
            state.connection === "online" ? "text-success-700" : "font-semibold text-warning-800",
          )}
        >
          {t(`connection.${state.connection}`)}
        </span>
      </SessionHeader>

      {state.ended ? (
        <Banner tone="info">{t("ended")}</Banner>
      ) : inControl ? (
        <Banner tone="success" className="flex-wrap">
          <span className="flex-1">{t("cohost.youControl")}</span>
          <Link href={`/host/${sessionId}`} className={buttonClass()}>
            {t("cohost.openPresenter")}
          </Link>
        </Banner>
      ) : (
        <Banner tone="warning" className="flex-wrap">
          <span className="flex-1">
            {t("cohost.controlledBy", { name: controller?.displayName ?? "" })}
          </span>
          <Button onClick={() => setConfirming(true)}>
            {isOwner ? t("cohost.takeBack") : t("cohost.takeOver")}
          </Button>
        </Banner>
      )}

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4">
        <QaPanel
          questions={state.questions}
          open={state.qaOpen}
          ended={state.ended}
          canToggle={inControl}
          onSetOpen={(open) => void controls.setQa(open)}
          onModerate={controls.moderate}
        />
      </main>

      {peopleOpen && (
        <PeopleDrawer
          state={people}
          controls={peopleControls}
          // Renaming and removing people is part of presenter control.
          ended={state.ended || !inControl}
          onClose={() => setPeopleOpen(false)}
        />
      )}
      {confirming && (
        <Dialog
          title={isOwner ? t("cohost.takeBackTitle") : t("cohost.takeOverTitle")}
          closeLabel={tc("close")}
          onClose={() => setConfirming(false)}
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm">
              {isOwner
                ? t("cohost.takeBackBody", { name: controller?.displayName ?? "" })
                : t("cohost.takeOverBody", { name: control.owner.displayName })}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                {t("cohost.cancel")}
              </Button>
              <Button disabled={taking} onClick={() => void take()}>
                {isOwner ? t("cohost.takeBack") : t("cohost.takeOver")}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
