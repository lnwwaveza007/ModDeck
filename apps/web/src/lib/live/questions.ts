// Q&A on the host's screens (F6): the list presenter control moderates and the question the
// projector shows. Loaded with GET /sessions/{id}/live, then kept current by question_update.

import type { LiveQuestion, QuestionAction, RoomEventData } from "@moddeck/shared";
import { QUESTION_ACTION_STATUS } from "@moddeck/shared";

type Update = RoomEventData["question_update"]["updates"][number];

/** Only one question is pinned: a newer pin sends any other back to the list. */
function withPin(list: LiveQuestion[], pinnedId: string): LiveQuestion[] {
  return list.map((q) =>
    q.status === "highlighted" && q.id !== pinnedId ? { ...q, status: "visible" } : q,
  );
}

function upsert(list: LiveQuestion[], question: LiveQuestion): LiveQuestion[] {
  const found = list.some((q) => q.id === question.id);
  const next = found ? list.map((q) => (q.id === question.id ? question : q)) : [...list, question];
  return question.status === "highlighted" ? withPin(next, question.id) : next;
}

/** Applies the room's updates in order. */
export function applyQuestionUpdates(list: LiveQuestion[], updates: Update[]): LiveQuestion[] {
  let next = list;
  for (const update of updates) {
    switch (update.action) {
      case "created":
        // A batched "created" can come after the host already changed the question: keep that.
        if (!next.some((q) => q.id === update.question.id)) next = [...next, update.question];
        break;
      case "votes":
        next = next.map((q) => (q.id === update.questionId ? { ...q, votes: update.votes } : q));
        break;
      case "status":
        next =
          "question" in update
            ? upsert(next, update.question)
            : next.map((q) => (q.id === update.questionId ? { ...q, status: update.status } : q));
        break;
    }
  }
  return next;
}

/** What a press does on this screen at once, before the room confirms it. */
export function applyQuestionAction(
  list: LiveQuestion[],
  questionId: string,
  action: QuestionAction,
): LiveQuestion[] {
  const status = QUESTION_ACTION_STATUS[action];
  const next = list.map((q) => (q.id === questionId ? { ...q, status } : q));
  return status === "highlighted" ? withPin(next, questionId) : next;
}

/** Most votes first, then newest, as the students' "Top questions". */
export function byVotes(a: LiveQuestion, b: LiveQuestion): number {
  return b.votes - a.votes || b.createdAt.localeCompare(a.createdAt);
}

export interface QuestionGroups {
  pinned: LiveQuestion | null;
  open: LiveQuestion[];
  answered: LiveQuestion[];
  hidden: LiveQuestion[];
}

/** The host panel's sections: the pin, the open questions by votes, then answered and hidden. */
export function groupQuestions(list: LiveQuestion[]): QuestionGroups {
  const sorted = [...list].sort(byVotes);
  return {
    pinned: sorted.find((q) => q.status === "highlighted") ?? null,
    open: sorted.filter((q) => q.status === "visible"),
    answered: sorted.filter((q) => q.status === "answered"),
    hidden: sorted.filter((q) => q.status === "hidden"),
  };
}

export const pinnedQuestion = (list: LiveQuestion[]) =>
  list.find((q) => q.status === "highlighted") ?? null;
