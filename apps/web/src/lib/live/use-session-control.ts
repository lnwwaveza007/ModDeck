"use client";

// Who runs a session (F12): owner, co-host, the invite that waits, and who has presenter control.
// Like the participant list, it loads over REST and then follows the host socket's control_update
// events, which are not numbered or replayed: so it loads again each time the socket is online.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ControlUpdate, SessionControlView } from "@moddeck/shared";
import {
  cancelCohostInvite,
  getSessionControl,
  inviteCohost,
  removeCohost,
  takeSessionControl,
} from "@/lib/api/cohost";
import type { ConnectionStatus } from "@/lib/realtime/live-connection";

export interface SessionControlState {
  /** null until the first load. */
  view: SessionControlView | null;
  /** This user runs presenter control. True when the load failed: the api still checks each call. */
  inControl: boolean;
  /** The first load has answered, with the state or with an error. */
  settled: boolean;
}

export interface SessionControlActions {
  /** The co-host takes over; the owner takes back. Throws the ApiError. */
  take: () => Promise<void>;
  /** Owner. Returns the link to send; it is shown only this once. Throws the ApiError. */
  invite: (email?: string) => Promise<string>;
  cancelInvite: () => Promise<void>;
  removeCohost: () => Promise<void>;
}

export function useSessionControl(
  sessionId: string,
  subscribe: (listener: (update: ControlUpdate) => void) => () => void,
  connection: ConnectionStatus,
  onChange?: (update: ControlUpdate, view: SessionControlView) => void,
): [SessionControlState, SessionControlActions] {
  const [view, setView] = useState<SessionControlView | null>(null);
  const [failed, setFailed] = useState(false);
  const viewRef = useRef<SessionControlView | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    viewRef.current = view;
    onChangeRef.current = onChange;
  });

  const load = useCallback(async () => {
    try {
      setView(await getSessionControl(sessionId));
    } catch {
      // Keep what we have: presenter control works on, and the next reconnect loads again.
      setFailed(true);
    }
  }, [sessionId]);

  useEffect(
    () =>
      subscribe((update) => {
        const current = viewRef.current;
        if (!current) return;
        const { change, ...state } = update;
        const next = { ...current, ...state };
        setView(next);
        onChangeRef.current?.({ ...state, change }, next);
      }),
    [subscribe],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const online = connection === "online";
  useEffect(() => {
    if (!online) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [online, load]);

  const take = useCallback(async () => {
    setView(await takeSessionControl(sessionId));
  }, [sessionId]);

  const invite = useCallback(
    async (email?: string) => {
      const created = await inviteCohost(sessionId, email);
      setView((current) => current && { ...current, invite: created.invite });
      return created.url;
    },
    [sessionId],
  );

  const cancel = useCallback(async () => {
    await cancelCohostInvite(sessionId);
    setView((current) => current && { ...current, invite: null });
  }, [sessionId]);

  const remove = useCallback(async () => {
    await removeCohost(sessionId);
    setView(
      (current) => current && { ...current, cohost: null, controllerId: current.owner.userId },
    );
  }, [sessionId]);

  return [
    {
      view,
      inControl: view ? view.controllerId === view.viewerId : true,
      settled: view !== null || failed,
    },
    { take, invite, cancelInvite: cancel, removeCohost: remove },
  ];
}
