import { nextActivityState, type ActivityAction, type ActivityRunState } from "@moddeck/shared";
import type { ShortcutCommand } from "./shortcuts";
import type { ScreenLayers } from "./screen-channel";
import { runOf, type LiveSessionControls, type LiveSessionState } from "./use-live-session";

/** What the A key does to an activity in this state: start, stop or reopen. */
export function toggleAction(state: ActivityRunState): ActivityAction {
  if (state === "draft") return "start";
  if (state === "live") return "stop";
  return "reopen";
}

/**
 * Runs a slide or activity shortcut on the live session. Returns false for commands that are
 * not about the session (overlay, fullscreen, help): the screen handles those itself.
 */
export function runLiveCommand(
  command: ShortcutCommand,
  state: LiveSessionState,
  controls: LiveSessionControls,
  layers: [ScreenLayers, (next: Partial<ScreenLayers>) => void],
  durationSeconds?: number,
): boolean {
  const activity = state.slides[state.currentIndex]?.activity;
  switch (command) {
    case "next":
      // From the join screen, Next first shows the slide under it, so the room never misses it.
      if (layers[0].join) layers[1]({ join: false });
      else controls.next();
      return true;
    case "previous":
      controls.previous();
      return true;
    case "first":
      controls.goTo(0);
      return true;
    case "last":
      controls.goTo(state.slides.length - 1);
      return true;
    case "toggleActivity": {
      if (!activity) return true;
      const action = toggleAction(runOf(state.runs, activity.id).state);
      void controls.act(activity.id, action, action === "stop" ? undefined : durationSeconds);
      return true;
    }
    case "showResults": {
      if (!activity) return true;
      if (nextActivityState(runOf(state.runs, activity.id).state, "show_results")) {
        void controls.act(activity.id, "show_results");
      }
      return true;
    }
    case "blank":
      layers[1]({ blank: !layers[0].blank });
      return true;
    case "join":
      layers[1]({ join: !layers[0].join });
      return true;
    case "joinBar":
      layers[1]({ joinBar: !layers[0].joinBar });
      return true;
    default:
      return false;
  }
}
