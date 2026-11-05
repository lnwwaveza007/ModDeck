// Presenter control (single-screen host view) and the audience screen: REST shapes for running a
// live session, and the activity state machine both sides check.

import { z } from "zod";
import type { ActivityRunState, SessionStatus } from "./events";
import type { ActivitySlideKind, SlideDto } from "./slides";

// ---- Activity controls ------------------------------------------------------

// What the host can press on an activity. An activity starts only when the host presses Start:
// showing its slide never starts it.
export const ACTIVITY_ACTIONS = ["start", "stop", "show_results", "reopen"] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

// From which states each action is allowed, and the state it leads to. Results stay on screen
// until the host reopens the activity: there is no separate "hide results".
export const ACTIVITY_TRANSITIONS: Record<
  ActivityAction,
  { from: readonly ActivityRunState[]; to: ActivityRunState }
> = {
  start: { from: ["draft"], to: "live" },
  stop: { from: ["live"], to: "closed" },
  show_results: { from: ["live", "closed"], to: "results_shown" },
  reopen: { from: ["closed", "results_shown"], to: "live" },
};

/** The state after `action`, or null when the action is not allowed from `state`. */
export function nextActivityState(
  state: ActivityRunState,
  action: ActivityAction,
): ActivityRunState | null {
  const transition = ACTIVITY_TRANSITIONS[action];
  return transition.from.includes(state) ? transition.to : null;
}

/** The buttons the presenter shows for an activity in this state, in display order. */
export function availableActivityActions(state: ActivityRunState): ActivityAction[] {
  return ACTIVITY_ACTIONS.filter((action) => nextActivityState(state, action) !== null);
}

// Countdown timer for an activity. The host picks a duration on Start or Reopen; at zero the
// server stops the activity by itself.
export const ACTIVITY_TIMER_MIN_SECONDS = 5;
export const ACTIVITY_TIMER_MAX_SECONDS = 60 * 60;
export const ACTIVITY_TIMER_PRESETS = [30, 60, 120, 300] as const;

// PATCH /sessions/{sessionId}/activities/{activityId}. `durationSeconds` starts a countdown and
// only goes with start or reopen; without it the activity runs until the host stops it.
export const activityActionBodySchema = z
  .object({
    action: z.enum(ACTIVITY_ACTIONS),
    durationSeconds: z
      .int()
      .min(ACTIVITY_TIMER_MIN_SECONDS)
      .max(ACTIVITY_TIMER_MAX_SECONDS)
      .optional(),
  })
  .refine(
    (body) =>
      body.durationSeconds === undefined || body.action === "start" || body.action === "reopen",
    { message: "durationSeconds goes with start or reopen only", path: ["durationSeconds"] },
  );
export type ActivityActionBody = z.infer<typeof activityActionBodySchema>;

// ---- Activity wording -------------------------------------------------------

export const ACTIVITY_PROMPT_MAX = 300;
export const POLL_OPTION_LABEL_MAX = 120;
export const POLL_OPTIONS_MIN = 2;
export const POLL_OPTIONS_MAX = 10;

// PATCH /decks/{deckId}/slides/{slideId}/activity: the wording of a poll or word cloud.
// `options` is the whole list in order (polls only): an option with an `id` keeps it, one
// without is new, and a missing id is removed. Once the activity has started in a session that
// is still open, only the wording can change: the same options, in the same order.
export const activityWordingBodySchema = z.object({
  prompt: z.string().trim().min(1).max(ACTIVITY_PROMPT_MAX),
  options: z
    .array(
      z.object({
        id: z.uuid().optional(),
        label: z.string().trim().min(1).max(POLL_OPTION_LABEL_MAX),
      }),
    )
    .max(POLL_OPTIONS_MAX)
    .optional(),
});
export type ActivityWordingBody = z.infer<typeof activityWordingBodySchema>;

export interface ActivityOptionDto {
  id: string;
  label: string;
}

/** An activity with what a live screen needs to draw it. */
export interface LiveActivity {
  id: string;
  type: ActivitySlideKind;
  prompt: string;
  options: ActivityOptionDto[];
}

// ---- Live session view ------------------------------------------------------

// PATCH /sessions/{sessionId}: move the room to another slide of the deck.
export const currentSlideBodySchema = z.object({ currentSlideId: z.uuid() });
export type CurrentSlideBody = z.infer<typeof currentSlideBodySchema>;

/** One slide as the presenter and the audience screen draw it. */
export interface LiveSlide extends Pick<SlideDto, "id" | "position" | "kind" | "elements"> {
  activity: LiveActivity | null;
}

/** State of one activity in this session. An activity with no run yet is in draft. */
export interface ActivityRunDto {
  activityId: string;
  activityRunId: string;
  state: ActivityRunState;
  /** Countdown end, ms since epoch (server clock), or null without a timer. */
  endsAt: number | null;
}

/** GET /sessions/{sessionId}/live: everything the presenter and the audience screen start from. */
export interface LiveSessionView {
  id: string;
  /** For wording edits, which go to the deck (PATCH /decks/{deckId}/slides/{slideId}/activity). */
  deckId: string;
  pin: string;
  status: SessionStatus;
  title: string;
  joinUrl: string;
  startedAt: string;
  /** Server clock in ms when the response was built, to correct the browser clock. */
  serverNow: number;
  currentSlideId: string | null;
  slides: LiveSlide[];
  runs: ActivityRunDto[];
  participantCount: number;
}
