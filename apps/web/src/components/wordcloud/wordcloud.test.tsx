import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import {
  WORD_MAX_LENGTH,
  wordKey,
  type AnswerAck,
  type RoomEvent,
  type SlideActivityView,
  type WordResult,
} from "@moddeck/shared";
import { WordCloudEditor } from "@/components/editor/WordCloudEditor";
import { WordCloudActivity, type SendWord } from "@/components/join/WordCloudActivity";
import {
  isWordCloudComplete,
  wordCloudBody,
  wordCloudDraftOf,
  type WordCloudDraft,
} from "@/lib/editor/word-cloud-draft";
import { applyRoomEvent } from "@/lib/live/student-activity";
import type { ConnectionStatus } from "@/lib/realtime/live-connection";
import { LiveStatusProvider } from "@/lib/realtime/live-status";
import { renderWithIntl } from "@/test/render";
import { WordCloud, wordColor, wordScale } from "./WordCloud";

const view = (
  state: "live" | "closed" | "results_shown",
  overrides: Partial<SlideActivityView> = {},
  maxEntries = 2,
): SlideActivityView => ({
  activity: {
    id: "a1",
    type: "word_cloud",
    prompt: "One word for `today`?",
    options: [],
    allowAnswerChange: false,
    maxEntries,
  },
  run: { activityId: "a1", activityRunId: "r1", state, endsAt: null, reopened: false },
  results: null,
  cloud: null,
  ...overrides,
});

const ok = (text: string, sent: number, duplicate = false): AnswerAck<WordResult> => ({
  ok: true,
  duplicate,
  result: { text, sent },
});
const fail = (code: "LIMIT_REACHED" | "ACTIVITY_CLOSED" | "INVALID_PAYLOAD" | "INTERNAL") =>
  ({ ok: false, error: { code, message: code } }) as AnswerAck<WordResult>;

/** The student screen with the words the page keeps, as LiveSession does. */
function Phone({
  activity,
  send,
  initial = [],
}: {
  activity: SlideActivityView;
  send: SendWord;
  initial?: string[];
}) {
  const [words, setWords] = useState(initial);
  return (
    <WordCloudActivity
      view={activity}
      myWords={words}
      onSent={(text) =>
        setWords((sent) =>
          sent.some((word) => wordKey(word) === wordKey(text)) ? sent : [...sent, text],
        )
      }
      send={send}
    />
  );
}

function renderPhone(
  activity: SlideActivityView,
  send: SendWord = jest.fn(),
  { status = "online", initial }: { status?: ConnectionStatus; initial?: string[] } = {},
  locale: "en" | "th" = "en",
) {
  return renderWithIntl(
    <LiveStatusProvider status={status}>
      <Phone activity={activity} send={send} initial={initial} />
    </LiveStatusProvider>,
    locale,
  );
}

const field = () => screen.getByRole("textbox", { name: "Your word" });
const sendButton = () => screen.getByRole("button", { name: "Send" });
const type = (text: string) => fireEvent.change(field(), { target: { value: text } });

beforeAll(() => {
  if (!globalThis.crypto.randomUUID) {
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: () => `id-${Math.random()}` });
  }
});
beforeEach(() => localStorage.clear());

describe("WordCloudActivity: sending", () => {
  it("renders the prompt with code, and keeps Send off until a word is typed", () => {
    const { container } = renderPhone(view("live"));
    expect(container.querySelector("code")).toHaveTextContent("today");
    expect(sendButton()).toBeDisabled();
    type("rain");
    expect(sendButton()).toBeEnabled();
  });

  it("sends the word, lists it only after the server's ack, and clears the field", async () => {
    let ack: (reply: AnswerAck<WordResult>) => void = () => undefined;
    const send = jest.fn(() => new Promise<AnswerAck<WordResult>>((resolve) => (ack = resolve)));
    renderPhone(view("live"), send);

    type("  Rain ");
    fireEvent.click(sendButton());
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    // The raw text goes to the server, which normalizes it: the phone does not decide.
    expect(send.mock.calls[0]).toEqual([
      { activityRunId: "r1", text: "  Rain ", answerId: expect.any(String) },
    ]);
    expect(screen.queryByText("Your words (1 of 2)")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();

    ack(ok("Rain", 1));
    expect(await screen.findByText("Your words (1 of 2)")).toBeInTheDocument();
    expect(screen.getByText("Rain")).toBeInTheDocument();
    expect(field()).toHaveValue("");
    expect(screen.getByText("You can send 1 more word.")).toBeInTheDocument();
  });

  it("sends with Enter", async () => {
    const send = jest.fn(async () => ok("hi", 1));
    renderPhone(view("live"), send);
    type("hi");
    fireEvent.submit(field().closest("form")!);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  });

  it("sends the same answerId again after a failed send, and a new one for a new word", async () => {
    const send = jest
      .fn<Promise<AnswerAck<WordResult>>, Parameters<SendWord>>()
      .mockRejectedValueOnce(new Error("no ack"))
      .mockResolvedValueOnce(ok("rain", 1))
      .mockResolvedValueOnce(ok("sun", 2));
    renderPhone(view("live"), send);

    type("rain");
    fireEvent.click(sendButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Not sent");
    expect(field()).toHaveValue("rain"); // nothing typed is lost

    fireEvent.click(sendButton());
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1][0].answerId).toBe(send.mock.calls[0][0].answerId);
    await screen.findByText("Your words (1 of 2)");

    type("sun");
    fireEvent.click(sendButton());
    await waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    expect(send.mock.calls[2][0].answerId).not.toBe(send.mock.calls[0][0].answerId);
  });

  it("says so when the word was already sent, but not after a retry of a word that just counted", async () => {
    const send = jest
      .fn<Promise<AnswerAck<WordResult>>, Parameters<SendWord>>()
      .mockResolvedValueOnce(ok("rain", 1, true)) // the first ack was lost: a duplicate of a new word
      .mockResolvedValueOnce(ok("rain", 1, true));
    renderPhone(view("live"), send);

    type("rain");
    fireEvent.click(sendButton());
    await screen.findByText("Your words (1 of 2)");
    expect(screen.queryByText("You already sent that word.")).not.toBeInTheDocument();

    type("RAIN");
    fireEvent.click(sendButton());
    expect(await screen.findByText("You already sent that word.")).toBeInTheDocument();
    // Still one word in the list, and no entry used up.
    expect(screen.getByText("Your words (1 of 2)")).toBeInTheDocument();
  });
});

describe("WordCloudActivity: limits", () => {
  it("counts visible characters: a Thai word with marks is short, not long", () => {
    renderPhone(view("live"));
    type("ก่".repeat(WORD_MAX_LENGTH));
    expect(screen.getByText(`${WORD_MAX_LENGTH}/${WORD_MAX_LENGTH}`)).toBeInTheDocument();
    expect(sendButton()).toBeEnabled();
    expect(screen.queryByText(/Too long/)).not.toBeInTheDocument();

    type("ก่".repeat(WORD_MAX_LENGTH + 1));
    expect(screen.getByText(`26/${WORD_MAX_LENGTH}`)).toBeInTheDocument();
    expect(screen.getByText("Too long. Use at most 25 characters.")).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
    expect(field()).toHaveAttribute("aria-invalid", "true");
  });

  it("counts a Thai tone mark with its letter in the Thai screen too", () => {
    renderPhone(view("live"), jest.fn(), {}, "th");
    fireEvent.change(screen.getByRole("textbox", { name: "คำของคุณ" }), {
      target: { value: "ที่นี่" },
    });
    expect(screen.getByText("2/25")).toBeInTheDocument();
  });

  it("stops at the limit of the activity: the field and Send turn off", () => {
    renderPhone(view("live", {}, 2), jest.fn(), { initial: ["rain", "sun"] });
    expect(field()).toBeDisabled();
    expect(sendButton()).toBeDisabled();
    expect(screen.getByText("You have sent all your words.")).toBeInTheDocument();
    expect(screen.getByText("Your words (2 of 2)")).toBeInTheDocument();
  });

  it("turns off when the server says the limit is reached, whatever the phone counted", async () => {
    const send = jest.fn(async () => fail("LIMIT_REACHED"));
    renderPhone(view("live", {}, 2), send, { initial: ["rain"] });
    type("sun");
    fireEvent.click(sendButton());
    expect(await screen.findByText("You have sent all your words.")).toBeInTheDocument();
    expect(field()).toBeDisabled();
  });

  it("says so when the server found the activity closed", async () => {
    renderPhone(
      view("live"),
      jest.fn(async () => fail("ACTIVITY_CLOSED")),
    );
    type("late");
    fireEvent.click(sendButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Sending closed");
    expect(field()).toHaveValue("late");
  });
});

describe("WordCloudActivity: offline", () => {
  it.each(["reconnecting", "offline"] as const)(
    "keeps Send off while %s, and keeps what was typed",
    (status) => {
      const send = jest.fn();
      renderPhone(view("live"), send, { status });
      type("rain");
      expect(sendButton()).toBeDisabled();
      fireEvent.submit(field().closest("form")!);
      expect(send).not.toHaveBeenCalled();
      expect(field()).toHaveValue("rain");
    },
  );

  it("keeps the typed word in local storage and restores it after a reload", () => {
    renderPhone(view("live"), jest.fn(), { status: "offline" });
    type("ลม");
    expect(localStorage.getItem("moddeck:draft:word:r1")).toBe("ลม");

    cleanup();
    renderPhone(view("live"), jest.fn(), { status: "online" });
    expect(field()).toHaveValue("ลม");
    expect(sendButton()).toBeEnabled();
  });

  it("forgets the draft once the server has counted the word", async () => {
    renderPhone(
      view("live"),
      jest.fn(async () => ok("rain", 1)),
    );
    type("rain");
    fireEvent.click(sendButton());
    await screen.findByText("Your words (1 of 2)");
    expect(localStorage.getItem("moddeck:draft:word:r1")).toBeNull();
  });
});

describe("WordCloudActivity: after the activity", () => {
  it("shows Sending closed and what this student sent", () => {
    renderPhone(view("closed"), jest.fn(), { initial: ["rain"] });
    expect(screen.getByText("Sending closed")).toBeInTheDocument();
    expect(screen.getByText("rain")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("says when this student sent nothing", () => {
    renderPhone(view("closed"));
    expect(screen.getByText("You did not send a word.")).toBeInTheDocument();
  });

  it("shows the cloud with the student's own words ringed, once results are shown", () => {
    renderPhone(
      view("results_shown", {
        cloud: {
          entries: 4,
          words: [
            { key: "rain", text: "Rain", count: 3 },
            { key: "sun", text: "sun", count: 1 },
          ],
        },
      }),
      jest.fn(),
      { initial: ["RAIN"] },
    );
    expect(screen.getByText("4 words sent")).toBeInTheDocument();
    const cloud = screen.getByRole("list", { name: "Word cloud" });
    expect(within(cloud).getByText("Rain")).toHaveClass("ring-primary-500");
    expect(within(cloud).getByText("sun")).not.toHaveClass("ring-primary-500");
  });

  it("draws no cloud while the activity is live, even if the phone has the words", () => {
    renderPhone(
      view("live", { cloud: { entries: 1, words: [{ key: "rain", text: "rain", count: 1 }] } }),
    );
    expect(screen.queryByRole("list", { name: "Word cloud" })).not.toBeInTheDocument();
  });

  it("says so when the results hold no word", () => {
    renderPhone(view("results_shown", { cloud: { entries: 0, words: [] } }));
    expect(screen.getByText("No words yet")).toBeInTheDocument();
  });
});

describe("WordCloud", () => {
  const words = [
    { key: "rain", text: "rain", count: 5 },
    { key: "น้ำ", text: "น้ำ", count: 2 },
    { key: "ผู้ใหญ่", text: "ผู้ใหญ่", count: 1 },
  ];

  it("draws every word whole, so Thai vowels and tone marks stay with their letter", () => {
    renderWithIntl(<WordCloud words={words} scale="panel" />, "th");
    for (const { text } of words) {
      const item = screen.getByText(text);
      // One element, one text node: never split by the layout, and never wrapped.
      expect(item.textContent).toBe(text);
      expect(item.childNodes).toHaveLength(1);
      expect(item).toHaveClass("whitespace-nowrap");
    }
  });

  it("leaves room above and below the line for Thai marks", () => {
    renderWithIntl(<WordCloud words={words} scale="panel" />, "en");
    expect(screen.getByText("น้ำ").className).toMatch(/leading-\[1\.6\]/);
  });

  it("grows a word with its count, and never makes a bigger count smaller", () => {
    renderWithIntl(<WordCloud words={words} scale="stage" />, "en");
    const scale = (text: string) => Number(screen.getByText(text).dataset.scale);
    expect(scale("rain")).toBeGreaterThan(scale("น้ำ"));
    expect(scale("น้ำ")).toBeGreaterThan(scale("ผู้ใหญ่"));
  });

  it("describes each word and its count for a screen reader", () => {
    renderWithIntl(<WordCloud words={words} scale="panel" />, "en");
    expect(screen.getByLabelText("rain, sent 5 times")).toBeInTheDocument();
    expect(screen.getByLabelText("ผู้ใหญ่, sent 1 time")).toBeInTheDocument();
  });

  it("gives a word the same color everywhere", () => {
    expect(wordColor("rain")).toBe(wordColor("rain"));
    expect(wordColor("น้ำ")).toMatch(/^text-/);
  });
});

describe("wordScale", () => {
  it("only grows with the count", () => {
    const sizes = [1, 2, 3, 5, 8, 13].map((count) => wordScale(count, 13, 6));
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);
    expect(new Set(sizes).size).toBe(sizes.length);
  });

  it("draws a long list smaller as a whole, so the top 60 still fit", () => {
    expect(wordScale(5, 5, 60)).toBeLessThan(wordScale(5, 5, 20));
    expect(wordScale(5, 5, 20)).toBeLessThan(wordScale(5, 5, 6));
  });

  it("keeps the smallest word readable and the biggest bounded", () => {
    expect(wordScale(1, 1000, 6)).toBeGreaterThanOrEqual(1);
    expect(wordScale(10, 10, 6)).toBeLessThanOrEqual(3);
  });
});

describe("applyRoomEvent for a word cloud", () => {
  const event = <T extends RoomEvent["type"]>(
    type: T,
    data: Extract<RoomEvent, { type: T }>["data"],
  ) => ({ type, seq: 1, sessionId: "s", at: 0, data }) as RoomEvent;
  const update = event("word_update", {
    activityRunId: "r1",
    entries: 3,
    words: [{ key: "rain", text: "rain", count: 3 }],
  });

  it("keeps the cloud once results are shown, and follows its updates", () => {
    const shown = applyRoomEvent(view("results_shown"), update);
    expect(shown?.cloud).toEqual({ entries: 3, words: [{ key: "rain", text: "rain", count: 3 }] });
  });

  it("drops a cloud that arrives while the activity is live or closed", () => {
    expect(applyRoomEvent(view("live"), update)?.cloud).toBeNull();
    expect(applyRoomEvent(view("closed"), update)?.cloud).toBeNull();
  });

  it("ignores the cloud of another run", () => {
    const other = event("word_update", { activityRunId: "r2", entries: 1, words: [] });
    expect(applyRoomEvent(view("results_shown"), other)?.cloud).toBeNull();
  });

  it("takes the cloud away when the host hides the results or reopens", () => {
    const withCloud = applyRoomEvent(view("results_shown"), update)!;
    const hidden = applyRoomEvent(
      withCloud,
      event("activity_state", {
        activityId: "a1",
        activityRunId: "r1",
        state: "closed",
        endsAt: null,
        reopened: false,
      }),
    );
    expect(hidden?.run?.state).toBe("closed");
    expect(hidden?.cloud).toBeNull();
  });

  it("follows an edit of the limit", () => {
    const edited = applyRoomEvent(
      view("live"),
      event("activity_edited", { activityId: "a1", prompt: "New?", options: [], maxEntries: 3 }),
    );
    expect(edited?.activity).toMatchObject({ prompt: "New?", maxEntries: 3 });
  });
});

describe("WordCloudEditor", () => {
  const draft: WordCloudDraft = { prompt: "One word?", maxEntries: 1 };

  it("reports every change of the prompt and the limit", () => {
    const onChange = jest.fn();
    renderWithIntl(<WordCloudEditor initial={draft} onChange={onChange} />, "en");

    fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), {
      target: { value: "Another?" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ prompt: "Another?", maxEntries: 1 });
    fireEvent.click(screen.getByRole("radio", { name: "3" }));
    expect(onChange).toHaveBeenLastCalledWith({ prompt: "Another?", maxEntries: 3 });
    expect(screen.getByRole("radio", { name: "3" })).toBeChecked();
  });

  it("offers 1 to 3 words, and tells the fixed length", () => {
    renderWithIntl(<WordCloudEditor initial={draft} onChange={jest.fn()} />, "en");
    const group = within(screen.getByRole("group", { name: "Words per student" }));
    expect(group.getAllByRole("radio").map((radio) => (radio as HTMLInputElement).value)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(screen.getByText(/up to 25 characters/)).toBeInTheDocument();
  });

  it("warns while the prompt is empty", () => {
    renderWithIntl(
      <WordCloudEditor initial={{ prompt: "", maxEntries: 2 }} onChange={jest.fn()} />,
      "en",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Write the prompt");
  });
});

describe("word cloud drafts", () => {
  it("starts from the saved activity, with one word per student by default", () => {
    expect(
      wordCloudDraftOf({
        activity: { id: "a", type: "word_cloud", prompt: "Q", options: [], maxEntries: 3 },
      }),
    ).toEqual({ prompt: "Q", maxEntries: 3 });
    expect(wordCloudDraftOf({ activity: null })).toEqual({ prompt: "", maxEntries: 1 });
  });

  it("is complete with a prompt and a limit of 1 to 3", () => {
    expect(isWordCloudComplete({ prompt: "Q", maxEntries: 1 })).toBe(true);
    expect(isWordCloudComplete({ prompt: "  ", maxEntries: 1 })).toBe(false);
    expect(isWordCloudComplete({ prompt: "Q", maxEntries: 0 })).toBe(false);
    expect(isWordCloudComplete({ prompt: "Q", maxEntries: 4 })).toBe(false);
    expect(isWordCloudComplete({ prompt: "Q", maxEntries: 1.5 })).toBe(false);
  });

  it("sends the prompt and the limit, and no options", () => {
    expect(wordCloudBody({ prompt: "Q", maxEntries: 2 })).toEqual({ prompt: "Q", maxEntries: 2 });
  });
});
