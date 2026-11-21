"use client";

// The host's participant list (F13): loaded over REST, then kept current by the host socket's
// participant events. Those events are not numbered or replayed, and they only reach this window
// once its socket is in the session's host room. So the list loads again each time the socket
// comes online, the first time included: nothing that changed before that point is missed.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ParticipantRow } from "@moddeck/shared";
import { listParticipants, removeParticipant, renameParticipant } from "@/lib/api/participants";
import type { ConnectionStatus, PeopleEvent } from "@/lib/realtime/live-connection";

type Rows = ReadonlyMap<string, ParticipantRow>;

function applyEvent(rows: Rows, event: PeopleEvent): Rows {
  const next = new Map(rows);
  if (event.type === "update") next.set(event.row.id, event.row);
  else next.delete(event.participantId);
  return next;
}

/** Online first, then in the order they joined, so the list does not jump while the host reads. */
function sortRows(rows: Rows): ParticipantRow[] {
  return [...rows.values()].sort(
    (a, b) => Number(b.online) - Number(a.online) || a.joinedAt.localeCompare(b.joinedAt),
  );
}

export interface ParticipantsState {
  /** null until the first load. */
  rows: ParticipantRow[] | null;
  online: number;
  failed: boolean;
}

export interface ParticipantsControls {
  /** Throws the ApiError, so the form can show why the name was refused. */
  rename: (participantId: string, nickname: string) => Promise<void>;
  remove: (participantId: string) => Promise<void>;
  reload: () => void;
}

export function useParticipants(
  sessionId: string,
  subscribe: (listener: (event: PeopleEvent) => void) => () => void,
  connection: ConnectionStatus,
): [ParticipantsState, ParticipantsControls] {
  const [rows, setRows] = useState<Rows | null>(null);
  const [failed, setFailed] = useState(false);
  // Only the newest load sets the list. While it is on its way, events wait in its queue and are
  // applied on top of its answer, so an older answer can never undo a newer event.
  const generation = useRef(0);
  const queue = useRef<PeopleEvent[] | null>(null);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    const waiting: PeopleEvent[] = [];
    queue.current = waiting;
    try {
      const list = await listParticipants(sessionId);
      if (mine !== generation.current) return;
      let loaded: Rows = new Map(list.map((row) => [row.id, row]));
      for (const event of waiting) loaded = applyEvent(loaded, event);
      setRows(loaded);
      setFailed(false);
    } catch {
      if (mine === generation.current) setFailed(true);
    } finally {
      if (mine === generation.current) queue.current = null;
    }
  }, [sessionId]);

  useEffect(
    () =>
      subscribe((event) => {
        if (queue.current) queue.current.push(event);
        else setRows((current) => current && applyEvent(current, event));
      }),
    [subscribe],
  );

  // At once, for a window whose socket never comes online (an ended session), then every time the
  // socket is online again. Outside the effect body: load() sets state.
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

  const rename = useCallback(
    async (participantId: string, nickname: string) => {
      const row = await renameParticipant(sessionId, participantId, nickname);
      setRows((current) => current && applyEvent(current, { type: "update", row }));
    },
    [sessionId],
  );

  const remove = useCallback(
    async (participantId: string) => {
      await removeParticipant(sessionId, participantId);
      setRows((current) => current && applyEvent(current, { type: "removed", participantId }));
    },
    [sessionId],
  );

  const sorted = useMemo(() => (rows ? sortRows(rows) : null), [rows]);
  return [
    {
      rows: sorted,
      online: sorted?.filter((row) => row.online).length ?? 0,
      failed,
    },
    { rename, remove, reload: () => void load() },
  ];
}
