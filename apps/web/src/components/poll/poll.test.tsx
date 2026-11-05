import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { AnswerAck, RoomEvent, SlideActivityView, VoteResult } from "@moddeck/shared";
import { PollActivity, type SendVote } from "@/components/join/PollActivity";
import { PollEditor } from "@/components/editor/PollEditor";
import {
  isPollComplete,
  pollBody,
  pollDraftOf,
  withSavedIds,
  type PollDraft,
} from "@/lib/editor/poll-draft";
import { applyRoomEvent } from "@/lib/live/student-activity";
import { LiveStatusProvider } from "@/lib/realtime/live-status";
import type { ConnectionStatus } from "@/lib/realtime/live-connection";
import { renderWithIntl } from "@/test/render";
import { PollChart, percentOf } from "./PollChart";

const view = (
  state: "live" | "closed" | "results_shown",
  overrides: Partial<SlideActivityView> = {},
): SlideActivityView => ({
  activity: {
    id: "a1",
    type: "poll",
    prompt: "Which `layer`?",
    options: [
      { id: "o1", label: "Alpha" },
      { id: "o2", label: "Beta" },
    ],
    allowAnswerChange: false,
  },
  run: { activityId: "a1", activityRunId: "r1", state, endsAt: null, reopened: false },
  results: null,
  ...overrides,
});

const ok = (optionId: string, duplicate = false): AnswerAck<VoteResult> => ({
  ok: true,
  duplicate,
  result: { optionIds: [optionId] },
});

/** The student screen with the answer the page keeps, as LiveSession does. */
function Phone({
  poll,
  send,
  initial = null,
}: {
  poll: SlideActivityView;
  send: SendVote;
  initial?: string | null;
}) {
  const [mine, setMine] = useState(initial);
  return <PollActivity view={poll} myOptionId={mine} onAnswered={setMine} send={send} />;
}

function renderPhone(
  poll: SlideActivityView,
  send: SendVote = jest.fn(),
  { status = "online", initial }: { status?: ConnectionStatus; initial?: string | null } = {},
) {
  return renderWithIntl(
    <LiveStatusProvider status={status}>
      <Phone poll={poll} send={send} initial={initial} />
    </LiveStatusProvider>,
    "en",
  );
}

const option = (name: RegExp | string) => screen.getByRole("radio", { name });
const submit = () => screen.getByRole("button", { name: "Submit" });

describe("PollActivity", () => {
  beforeAll(() => {
    if (!globalThis.crypto.randomUUID) {
      Object.defineProperty(globalThis.crypto, "randomUUID", {
        value: () => `id-${Math.random()}`,
      });
    }
  });

  it("renders code and math in the question and options", () => {
    const poll = view("live");
    poll.activity.options[1].label = "$x^2$";
    const { container } = renderPhone(poll);
    expect(container.querySelector("code")).toHaveTextContent("layer");
    expect(container.querySelector(".katex")).toBeInTheDocument();
  });

  it('says "Answer sent" only after the server acknowledges', async () => {
    let ack: (reply: AnswerAck<VoteResult>) => void = () => undefined;
    const send = jest.fn(() => new Promise<AnswerAck<VoteResult>>((resolve) => (ack = resolve)));
    renderPhone(view("live"), send);

    expect(submit()).toBeDisabled();
    fireEvent.click(option(/Alpha/));
    fireEvent.click(submit());

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]).toEqual([
      { activityRunId: "r1", optionIds: ["o1"], answerId: expect.any(String) },
    ]);
    expect(screen.queryByText("Answer sent")).not.toBeInTheDocument();

    ack(ok("o1"));
    expect(await screen.findByText("Answer sent")).toBeInTheDocument();
    expect(screen.getByText("Your answer is locked.")).toBeInTheDocument();
    expect(option(/Alpha/)).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument();
  });

  it("sends the same answerId again after a failed send, and a new one for a new choice", async () => {
    const send = jest
      .fn<Promise<AnswerAck<VoteResult>>, Parameters<SendVote>>()
      .mockRejectedValueOnce(new Error("no ack"))
      .mockRejectedValueOnce(new Error("no ack"))
      .mockResolvedValueOnce(ok("o2"));
    renderPhone(view("live"), send);

    fireEvent.click(option(/Alpha/));
    fireEvent.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent("Not sent");
    expect(screen.queryByText("Answer sent")).not.toBeInTheDocument();

    fireEvent.click(submit());
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    await screen.findByRole("alert");
    expect(send.mock.calls[1][0].answerId).toBe(send.mock.calls[0][0].answerId);

    fireEvent.click(option(/Beta/));
    fireEvent.click(submit());
    expect(await screen.findByText("Answer sent")).toBeInTheDocument();
    expect(send.mock.calls[2][0].answerId).not.toBe(send.mock.calls[0][0].answerId);
  });

  it("shows the first answer when the server kept it", async () => {
    const send = jest.fn(async () => ok("o1", true));
    renderPhone(view("live"), send);
    fireEvent.click(option(/Beta/));
    fireEvent.click(submit());
    expect(await screen.findByText(/Your first answer counts/)).toBeInTheDocument();
    expect(option(/Alpha/)).toHaveAttribute("aria-checked", "true");
  });

  it("keeps the buttons off while offline", () => {
    renderPhone(view("live"), jest.fn(), { status: "reconnecting" });
    fireEvent.click(option(/Alpha/));
    expect(submit()).toBeDisabled();
  });

  it("lets a student change the answer after a reopen", async () => {
    const send = jest.fn(async () => ok("o2"));
    const reopened = view("live");
    reopened.run!.reopened = true;
    renderPhone(reopened, send, { initial: "o1" });

    expect(screen.getByText("Answer sent")).toBeInTheDocument();
    fireEvent.click(option(/Beta/));
    fireEvent.click(screen.getByRole("button", { name: "Change answer" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Answer sent")).toBeInTheDocument();
  });

  it("shows voting closed with the student's own answer", () => {
    renderPhone(view("closed"), jest.fn(), { initial: "o1" });
    expect(screen.getByText("Voting closed")).toBeInTheDocument();
    expect(screen.getByText("Your answer")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("shows the chart with the student's own answer marked", () => {
    renderPhone(
      view("results_shown", { results: { votes: { o1: 3, o2: 1 }, answered: 4 } }),
      jest.fn(),
      { initial: "o1" },
    );
    expect(screen.getByText("75% · 3")).toBeInTheDocument();
    expect(screen.getByText("25% · 1")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
  });
});

describe("PollChart", () => {
  it("draws the share of each option, and bars as wide as the share", () => {
    const { container } = renderWithIntl(
      <PollChart
        options={[
          { id: "o1", label: "Alpha" },
          { id: "o2", label: "Beta" },
        ]}
        tally={{ votes: { o1: 1, o2: 3 }, answered: 4 }}
        scale="stage"
      />,
      "en",
    );
    expect(screen.getByText("25% · 1")).toBeInTheDocument();
    expect(screen.getByText("75% · 3")).toBeInTheDocument();
    const widths = [...container.querySelectorAll<HTMLElement>("[style]")].map(
      (bar) => bar.style.width,
    );
    expect(widths).toEqual(["25%", "75%"]);
    expect(screen.queryByText("No votes yet")).not.toBeInTheDocument();
  });

  it("does not divide by zero", () => {
    expect(percentOf(0, 0)).toBe(0);
  });
});

describe("applyRoomEvent", () => {
  const event = <T extends RoomEvent["type"]>(type: T, data: RoomEvent<T>["data"]) =>
    ({ type, seq: 1, sessionId: "s1", at: 0, data }) as RoomEvent;
  const state = (next: "live" | "closed" | "results_shown") =>
    event("activity_state", {
      activityId: "a1",
      activityRunId: "r1",
      state: next,
      endsAt: null,
      reopened: false,
    });
  const counts = event("vote_update", {
    activityRunId: "r1",
    votes: { o1: 2 },
    answered: 2,
  });

  it("takes the activity from the slide the room moved to", () => {
    const next = view("live");
    expect(
      applyRoomEvent(null, event("slide_changed", { slideId: "s", index: 1, activity: next })),
    ).toBe(next);
    expect(
      applyRoomEvent(next, event("slide_changed", { slideId: "s", index: 2, activity: null })),
    ).toBeNull();
  });

  it("drops counts during voting: the phone draws no chart", () => {
    expect(applyRoomEvent(view("live"), counts)?.results).toBeNull();
  });

  it("keeps counts once results show, and drops them on a reopen", () => {
    const shown = applyRoomEvent(applyRoomEvent(view("closed"), state("results_shown")), counts);
    expect(shown?.results?.answered).toBe(2);
    expect(applyRoomEvent(shown, state("live"))?.results).toBeNull();
  });

  it("ignores another activity and takes new wording", () => {
    const other = event("activity_state", {
      activityId: "other",
      activityRunId: "r9",
      state: "closed",
      endsAt: null,
      reopened: false,
    });
    expect(applyRoomEvent(view("live"), other)?.run?.state).toBe("live");
    const edited = applyRoomEvent(
      view("live"),
      event("activity_edited", { activityId: "a1", prompt: "New?", options: [] }),
    );
    expect(edited?.activity.prompt).toBe("New?");
    expect(edited?.run?.state).toBe("live");
  });
});

describe("poll drafts", () => {
  const draft = (prompt: string, labels: string[]): PollDraft => ({
    prompt,
    rows: labels.map((label, i) => ({ key: `k${i}`, label })),
  });

  it("starts a new poll with two empty options", () => {
    const { rows, prompt } = pollDraftOf({
      activity: { id: "a", type: "poll", prompt: "", options: [] },
    });
    expect(prompt).toBe("");
    expect(rows.map((row) => row.label)).toEqual(["", ""]);
    expect(rows[0].id).toBeUndefined();
  });

  it("is complete with a question and 2 to 8 filled options", () => {
    expect(isPollComplete(draft("Q", ["a", "b"]))).toBe(true);
    expect(isPollComplete(draft(" ", ["a", "b"]))).toBe(false);
    expect(isPollComplete(draft("Q", ["a"]))).toBe(false);
    expect(isPollComplete(draft("Q", ["a", " "]))).toBe(false);
    expect(isPollComplete(draft("Q", Array(8).fill("x")))).toBe(true);
    expect(isPollComplete(draft("Q", Array(9).fill("x")))).toBe(false);
  });

  it("sends known options with their id and new ones without", () => {
    const body = pollBody({
      prompt: "Q",
      rows: [
        { key: "o1", id: "o1", label: "a" },
        { key: "k", label: "b" },
      ],
    });
    expect(body.options).toEqual([{ id: "o1", label: "a" }, { label: "b" }]);
  });

  it("gives saved rows their ids, and leaves a row added since then", () => {
    const sent = draft("Q", ["a", "b"]).rows;
    const current = { prompt: "Q2", rows: [...sent, { key: "new", label: "c" }] };
    const next = withSavedIds(current, sent, [{ id: "id-a" }, { id: "id-b" }]);
    expect(next.rows.map((row) => row.id)).toEqual(["id-a", "id-b", undefined]);
    expect(next.prompt).toBe("Q2");
  });
});

describe("PollEditor", () => {
  const renderEditor = (labels: string[]) => {
    const onChange = jest.fn();
    renderWithIntl(
      <PollEditor
        initial={{ prompt: "Q", rows: labels.map((label, i) => ({ key: `k${i}`, label })) }}
        onChange={onChange}
      />,
      "en",
    );
    return onChange;
  };

  it("reports what the host types", () => {
    const onChange = renderEditor(["a", "b"]);
    fireEvent.change(screen.getByRole("textbox", { name: "Question" }), {
      target: { value: "Which `x`?" },
    });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: "Which `x`?" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Option B" }), {
      target: { value: "$x$" },
    });
    expect(onChange.mock.lastCall?.[0].rows[1].label).toBe("$x$");
  });

  it("keeps at least two options", () => {
    renderEditor(["a", "b"]);
    expect(screen.getByRole("button", { name: "Remove option A" })).toBeDisabled();
  });

  it("stops adding at eight options", () => {
    renderEditor(Array(7).fill("x"));
    const add = screen.getByRole("button", { name: "Add option" });
    fireEvent.click(add);
    expect(screen.getByRole("textbox", { name: "Option H" })).toBeInTheDocument();
    expect(add).toBeDisabled();
  });

  it("says so while the poll is not complete", () => {
    renderEditor(["a", ""]);
    expect(screen.getByRole("status")).toHaveTextContent("It saves when complete");
  });
});
