import type { LiveQuestion, QuestionStatus, RoomEventData } from "@moddeck/shared";

/** The columns every Q&A view reads. Add `votes` with a participant filter for the student list. */
export const questionSelect = {
  id: true,
  text: true,
  anonymous: true,
  status: true,
  createdAt: true,
  _count: { select: { votes: true } },
  participant: { select: { nickname: true } },
} as const;

/** One question as phones, the presenter and the projector see it. */
export const questionView = (q: {
  id: string;
  text: string;
  anonymous: boolean;
  status: QuestionStatus;
  createdAt: Date;
  _count: { votes: number };
  votes?: { participantId: string }[];
  participant: { nickname: string };
}): LiveQuestion => ({
  id: q.id,
  text: q.text,
  anonymous: q.anonymous,
  status: q.status,
  createdAt: q.createdAt.toISOString(),
  votes: q._count.votes,
  // Anonymous: no author key at all, for the host too. The name never leaves the database.
  ...(!q.anonymous ? { author: q.participant.nickname } : {}),
  ...(q.votes ? { voted: q.votes.length > 0 } : {}),
});

type QuestionUpdate = RoomEventData["question_update"]["updates"][number];

/** The room update for a new status. A hidden question travels as its id only. */
export function statusUpdate(question: LiveQuestion): QuestionUpdate {
  const { id: questionId, status } = question;
  if (status === "hidden") return { action: "status", questionId, status };
  if (status === "deleted") throw new Error("Deleted questions are not sent to the room");
  return { action: "status", questionId, status, question };
}
