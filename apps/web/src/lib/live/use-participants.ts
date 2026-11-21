"use client";

// The host's participant list (F13): loaded over REST, then kept current by the host socket's
// participant events. Those events are not numbered or replayed, so the list loads again every
// time the socket comes back online after a drop.

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
  // While a load is on its way, events wait here and are applied on top of its answer.
  const pending = useRef<PeopleEvent[] | null>(null);

  const load = useCallback(async () => {
    pending.current = [];
    try {
      let loaded: Rows = new Map((await listParticipants(sessionId)).map((row) => [row.id, row]));
      for (const event of pending.current ?? []) loaded = applyEvent(loaded, event);
      setRows(loaded);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      pending.current = null;
    }
  }, [sessionId]);

  useEffect(
    () =>
      subscribe((event) => {
        if (pending.current) pending.current.push(event);
        else setRows((current) => current && applyEvent(current, event));
      }),
    [subscribe],
  );

  // Outside the effect body: load() sets state.
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  // Back online after a drop: what changed meanwhile was not replayed, so load it again.
  const seenOnline = useRef(false);
  const dropped = useRef(false);
  useEffect(() => {
    if (connection !== "online") {
      if (seenOnline.current) dropped.current = true;
      return;
    }
    seenOnline.current = true;
    if (!dropped.current) return;
    dropped.current = false;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [connection, load]);

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
