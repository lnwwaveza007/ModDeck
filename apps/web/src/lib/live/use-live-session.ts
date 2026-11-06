"use client";

// Live state of one session for the host's screens: presenter control and the audience screen.
// Both load GET /sessions/{id}/live once, then follow the room over a host socket, so every
// window the host opens shows the same slide and activity states (MD-13 resume included).

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ActivityAction,
  ActivityRunDto,
  ActivityWordingBody,
  LiveActivity,
  LiveSessionView,
  LiveSlide,
  PollTally,
  RoomEvent,
} from "@moddeck/shared";
import { ApiError } from "@/lib/api/client";
import { actOnActivity, editActivityWording, getLiveSession, moveToSlide } from "@/lib/api/live";
import { LiveConnection, type ConnectionStatus } from "@/lib/realtime/live-connection";

export type LiveLoadError = "notFound" | "network";

export interface LiveSessionState {
  view: LiveSessionView | null;
  slides: LiveSlide[];
  currentIndex: number;
  /** Activity id → run. An activity without a run is in draft. */
  runs: Record<string, ActivityRunDto>;
  /** Run id → the counts of a poll. */
  tallies: Record<string, PollTally>;
  connection: ConnectionStatus;
  ended: boolean;
  loadError: LiveLoadError | null;
  /** Server clock minus browser clock, ms. Countdowns add it to Date.now(). */
  clockOffset: number;
}

export interface LiveSessionControls {
  goTo: (index: number) => void;
  next: () => void;
  previous: () => void;
  act: (activityId: string, action: ActivityAction, durationSeconds?: number) => Promise<void>;
  editWording: (slideId: string, body: ActivityWordingBody) => Promise<void>;
}

const runsById = (runs: ActivityRunDto[]) =>
  Object.fromEntries(runs.map((run) => [run.activityId, run]));

function withActivity(
  slides: LiveSlide[],
  activity: Pick<LiveActivity, "id"> & Partial<LiveActivity>,
) {
  return slides.map((slide) =>
    slide.activity?.id === activity.id
      ? { ...slide, activity: { ...slide.activity, ...activity } }
      : slide,
  );
}

export function useLiveSession(
  sessionId: string,
  { onError }: { onError?: (error: unknown) => void } = {},
): [LiveSessionState, LiveSessionControls] {
  const [view, setView] = useState<LiveSessionView | null>(null);
  const [slides, setSlides] = useState<LiveSlide[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, ActivityRunDto>>({});
  const [tallies, setTallies] = useState<Record<string, PollTally>>({});
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const [ended, setEnded] = useState(false);
  const [loadError, setLoadError] = useState<LiveLoadError | null>(null);
  const [clockOffset, setClockOffset] = useState(0);

  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });

  // Slide moves go out one at a time, latest target wins. While one is on its way the room's
  // own slide_changed events are older than what this window shows, so they are held back.
  const sending = useRef(false);
  const queued = useRef<string | null>(null);
  const slidesRef = useRef<LiveSlide[]>([]);
  const currentRef = useRef<string | null>(null);
  useEffect(() => {
    slidesRef.current = slides;
    currentRef.current = currentId;
  });

  const load = useCallback(async () => {
    try {
      const value = await getLiveSession(sessionId);
      setClockOffset(value.serverNow - Date.now());
      setView(value);
      setSlides(value.slides);
      setRuns(runsById(value.runs));
      setTallies(value.tallies);
      // A refresh after the end: the socket would refuse to join, so read it from here too.
      if (value.status === "ended") setEnded(true);
      if (!sending.current) setCurrentId(value.currentSlideId ?? value.slides[0]?.id ?? null);
      setLoadError(null);
      return value;
    } catch (error) {
      const notFound = error instanceof ApiError && (error.status === 404 || error.status === 401);
      setLoadError(notFound ? "notFound" : "network");
      return null;
    }
  }, [sessionId]);

  useEffect(() => {
    let active = true;
    let connection: LiveConnection | undefined;
    const onEvent = (event: RoomEvent) => {
      switch (event.type) {
        case "slide_changed":
          if (!sending.current) setCurrentId(event.data.slideId);
          break;
        case "activity_state":
          setRuns((current) => ({ ...current, [event.data.activityId]: event.data }));
          break;
        case "vote_update": {
          const { activityRunId, votes, answered } = event.data;
          setTallies((current) => ({ ...current, [activityRunId]: { votes, answered } }));
          break;
        }
        case "activity_edited":
          setSlides((current) =>
            withActivity(current, { id: event.data.activityId, ...event.data }),
          );
          break;
        case "session_ended":
          setEnded(true);
          break;
      }
    };

    // Outside the effect body: load() sets state.
    const initial = setTimeout(() => void load().then(start), 0);
    function start(value: LiveSessionView | null) {
      if (!active || !value) return;
      connection = new LiveConnection({
        sessionId,
        role: "host",
        onStatus: (status) => {
          setConnection(status);
          if (status === "ended") setEnded(true);
        },
        // Too far behind for a replay: read the whole state again.
        onSnapshot: () => void load(),
        onEvent,
      });
      connection.connect();
    }
    return () => {
      active = false;
      clearTimeout(initial);
      connection?.close();
    };
  }, [sessionId, load]);

  const flush = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    let last: string | null = null;
    try {
      while (queued.current) {
        const target = queued.current;
        queued.current = null;
        try {
          last = (await moveToSlide(sessionId, target)).currentSlideId;
        } catch (error) {
          onErrorRef.current?.(error);
        }
      }
    } finally {
      sending.current = false;
    }
    // A move failed: show where the room really is.
    if (last !== currentRef.current) void load();
  }, [load, sessionId]);

  const goTo = useCallback(
    (index: number) => {
      const target = slidesRef.current[index];
      if (!target || target.id === currentRef.current) return;
      currentRef.current = target.id;
      setCurrentId(target.id);
      queued.current = target.id;
      void flush();
    },
    [flush],
  );

  const indexOfCurrent = () =>
    slidesRef.current.findIndex((slide) => slide.id === currentRef.current);
  const next = useCallback(() => goTo(indexOfCurrent() + 1), [goTo]);
  const previous = useCallback(() => goTo(indexOfCurrent() - 1), [goTo]);

  const act = useCallback(
    async (activityId: string, action: ActivityAction, durationSeconds?: number) => {
      try {
        const run = await actOnActivity(sessionId, activityId, {
          action,
          ...(durationSeconds ? { durationSeconds } : {}),
        });
        setRuns((current) => ({ ...current, [activityId]: run }));
      } catch (error) {
        onErrorRef.current?.(error);
        // Someone (another window, the timer) changed it first: show the real state.
        if (error instanceof ApiError && error.code === "INVALID_TRANSITION") void load();
      }
    },
    [load, sessionId],
  );

  const editWording = useCallback(
    async (slideId: string, body: ActivityWordingBody) => {
      if (!view) return;
      // Errors go to the caller: the wording dialog stays open with the text the host typed.
      const activity = await editActivityWording(view.deckId, slideId, body);
      setSlides((current) => withActivity(current, activity));
    },
    [view],
  );

  const currentIndex = Math.max(
    0,
    slides.findIndex((slide) => slide.id === currentId),
  );

  return [
    { view, slides, currentIndex, runs, tallies, connection, ended, loadError, clockOffset },
    { goTo, next, previous, act, editWording },
  ];
}

/** The run of an activity, draft when it has none yet. */
export function runOf(runs: Record<string, ActivityRunDto>, activityId: string): ActivityRunDto {
  return runs[activityId] ?? { activityId, activityRunId: "", state: "draft", endsAt: null };
}
