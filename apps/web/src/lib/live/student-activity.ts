// What a student phone knows about the activity on the current slide. It starts from
// GET /participants/me, then follows the room. A pure function, so a replay after a reconnect
// gives the same result as the live events did.

import type { RoomEvent, SlideActivityView } from "@moddeck/shared";

export function applyRoomEvent(
  view: SlideActivityView | null,
  event: RoomEvent,
): SlideActivityView | null {
  switch (event.type) {
    case "slide_changed":
      return event.data.activity;
    case "activity_state":
      if (view?.activity.id !== event.data.activityId) return view;
      return {
        ...view,
        run: event.data,
        // The counts of the new state follow in a vote_update. Results leave with a reopen or hide.
        results: event.data.state === "results_shown" ? view.results : null,
      };
    case "activity_edited":
      if (view?.activity.id !== event.data.activityId) return view;
      return {
        ...view,
        activity: { ...view.activity, prompt: event.data.prompt, options: event.data.options },
      };
    case "vote_update": {
      // The phone draws no chart during voting (MD-5 §7.1), so counts before results are dropped.
      if (view?.run?.activityRunId !== event.data.activityRunId) return view;
      if (view.run.state !== "results_shown") return view;
      const { votes, answered } = event.data;
      return { ...view, results: { votes, answered } };
    }
    default:
      return view;
  }
}

/** Students can send another answer: the host allowed it, or reopened the poll (MD-5 Q15). */
export const canChangeAnswer = (view: SlideActivityView) =>
  view.activity.allowAnswerChange || view.run?.reopened === true;
