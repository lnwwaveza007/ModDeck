import type { LiveQuestion } from "@moddeck/shared";
import {
  applyQuestionAction,
  applyQuestionUpdates,
  groupQuestions,
  pinnedQuestion,
} from "./questions";

const q = (id: string, overrides: Partial<LiveQuestion> = {}): LiveQuestion => ({
  id,
  text: `Question ${id}`,
  anonymous: true,
  status: "visible",
  createdAt: `2026-11-21T10:00:0${id.length}.000Z`,
  votes: 0,
  ...overrides,
});

describe("applyQuestionUpdates", () => {
  it("adds a new question once, and keeps a status the host set first", () => {
    const hidden = q("a", { status: "hidden" });
    const next = applyQuestionUpdates(
      [hidden],
      [
        { action: "created", question: q("a") },
        { action: "created", question: q("b") },
      ],
    );
    expect(next.map((x) => [x.id, x.status])).toEqual([
      ["a", "hidden"],
      ["b", "visible"],
    ]);
  });

  it("follows vote counts", () => {
    const next = applyQuestionUpdates([q("a")], [{ action: "votes", questionId: "a", votes: 7 }]);
    expect(next[0].votes).toBe(7);
  });

  it("hides by id only, and keeps the text the host already has", () => {
    const next = applyQuestionUpdates(
      [q("a")],
      [{ action: "status", questionId: "a", status: "hidden" }],
    );
    expect(next[0]).toMatchObject({ status: "hidden", text: "Question a" });
  });

  it("keeps one pin, even when an update misses the old pin's move back", () => {
    const next = applyQuestionUpdates(
      [q("a", { status: "highlighted" }), q("b")],
      [
        {
          action: "status",
          questionId: "b",
          status: "highlighted",
          question: q("b", { status: "highlighted" }),
        },
      ],
    );
    expect(pinnedQuestion(next)?.id).toBe("b");
    expect(next.find((x) => x.id === "a")?.status).toBe("visible");
  });

  it("brings back a question the host unhid on a screen that never had it", () => {
    const next = applyQuestionUpdates(
      [],
      [{ action: "status", questionId: "a", status: "visible", question: q("a") }],
    );
    expect(next.map((x) => x.id)).toEqual(["a"]);
  });
});

describe("applyQuestionAction", () => {
  it("pins one question and sends the old pin back", () => {
    const next = applyQuestionAction([q("a", { status: "highlighted" }), q("b")], "b", "pin");
    expect(next.map((x) => x.status)).toEqual(["visible", "highlighted"]);
  });

  it("takes the pin off when the pinned question is answered", () => {
    const next = applyQuestionAction([q("a", { status: "highlighted" })], "a", "answer");
    expect(pinnedQuestion(next)).toBeNull();
  });
});

describe("groupQuestions", () => {
  it("sorts open questions by votes, then newest, and splits off the rest", () => {
    const groups = groupQuestions([
      q("a", { votes: 1 }),
      q("bb", { votes: 5 }),
      q("ccc", { votes: 1 }),
      q("d", { status: "answered" }),
      q("e", { status: "hidden" }),
      q("f", { status: "highlighted" }),
    ]);
    expect(groups.pinned?.id).toBe("f");
    expect(groups.open.map((x) => x.id)).toEqual(["bb", "ccc", "a"]);
    expect(groups.answered.map((x) => x.id)).toEqual(["d"]);
    expect(groups.hidden.map((x) => x.id)).toEqual(["e"]);
  });
});
