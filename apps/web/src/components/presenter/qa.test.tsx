import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { LiveQuestion, LiveSessionView, RoomEvent } from "@moddeck/shared";
import { ApiError } from "@/lib/api/client";
import { getLiveSession, setQaOpen, setQuestionStatus } from "@/lib/api/live";
import { getSession } from "@/lib/api/sessions";
import type { LiveConnectionOptions } from "@/lib/realtime/live-connection";
import { renderWithIntl } from "@/test/render";
import { ToastProvider } from "@/components/ui/Toast";
import { AudienceScreen } from "./AudienceScreen";
import { PresenterControl } from "./PresenterControl";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));
jest.mock("@/lib/api/live");
jest.mock("@/lib/api/sessions");
jest.mock("@/lib/api/participants");
jest.mock("qrcode", () => ({ toDataURL: jest.fn().mockResolvedValue("data:image/png;base64,") }));

// The host socket: the test plays the server through `live.options`.
const live: { options?: LiveConnectionOptions } = {};
jest.mock("@/lib/realtime/live-connection", () => ({
  LiveConnection: jest.fn().mockImplementation((options: LiveConnectionOptions) => {
    live.options = options;
    return { connect: jest.fn(), close: jest.fn() };
  }),
}));

const question = (id: string, overrides: Partial<LiveQuestion> = {}): LiveQuestion => ({
  id,
  text: `Question ${id}`,
  anonymous: true,
  status: "visible",
  createdAt: "2026-11-21T10:00:00.000Z",
  votes: 0,
  ...overrides,
});

const view = (overrides: Partial<LiveSessionView> = {}): LiveSessionView => ({
  id: "s1",
  deckId: "d1",
  pin: "482914",
  status: "live",
  title: "INT365 Reactive Forms",
  joinUrl: "http://localhost:3000/j/482914",
  startedAt: new Date().toISOString(),
  serverNow: Date.now(),
  // The second slide: the first one shows the join panel over the stage.
  currentSlideId: "slide-1",
  slides: [0, 1].map((position) => ({
    id: `slide-${position}`,
    position,
    kind: "content" as const,
    elements: [],
    activity: null,
  })),
  runs: [],
  tallies: {},
  clouds: {},
  hiddenWords: {},
  showResultsLive: false,
  reactionsEnabled: true,
  qaOpen: true,
  questions: [],
  participantCount: 12,
  ...overrides,
});

function questionUpdate(updates: RoomEvent<"question_update">["data"]["updates"], seq = 1) {
  act(() =>
    live.options!.onEvent!({
      type: "question_update",
      seq,
      sessionId: "s1",
      at: Date.now(),
      data: { updates },
    }),
  );
}

async function renderPresenter(value = view()) {
  jest.mocked(getLiveSession).mockResolvedValue(value);
  renderWithIntl(
    <ToastProvider closeLabel="Close">
      <PresenterControl sessionId="s1" />
    </ToastProvider>,
    "en",
  );
  await screen.findByRole("heading", { name: "INT365 Reactive Forms" });
  await waitFor(() => expect(live.options).toBeDefined());
  return screen.getByRole("region", { name: "Q&A" });
}

async function renderScreen(value = view()) {
  jest.mocked(getLiveSession).mockResolvedValue(value);
  renderWithIntl(<AudienceScreen sessionId="s1" />, "en");
  await waitFor(() => expect(live.options).toBeDefined());
}

beforeEach(() => {
  jest.clearAllMocks();
  live.options = undefined;
  localStorage.clear();
  jest.mocked(getSession).mockResolvedValue({
    id: "s1",
    pin: "482914",
    status: "live",
    participantCount: 12,
    deck: { title: "INT365 Reactive Forms" },
    joinUrl: "http://localhost:3000/j/482914",
    serverNow: Date.now(),
  });
  jest.mocked(setQuestionStatus).mockImplementation(async (_s, id) => question(id));
  jest.mocked(setQaOpen).mockImplementation(async (_s, qaOpen) => ({ qaOpen }));
});

describe("Q&A panel in presenter control", () => {
  it("lists questions by votes, with no name on anonymous ones", async () => {
    const panel = await renderPresenter(
      view({
        questions: [
          question("low", { votes: 1, text: "Few votes", anonymous: false, author: "Mint" }),
          question("high", { votes: 9, text: "Many votes" }),
        ],
      }),
    );
    const items = within(within(panel).getByRole("region", { name: "Questions" })).getAllByRole(
      "listitem",
    );
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringMatching(/^Many votes▲ 9 votes·Anonymous/),
      expect.stringMatching(/^Few votes▲ 1 vote·Mint/),
    ]);
  });

  it("shows questions as they come in, with a new badge until the host marks them seen", async () => {
    const panel = await renderPresenter(view({ questions: [question("old")] }));
    expect(within(panel).queryByText("New")).not.toBeInTheDocument();

    questionUpdate([{ action: "created", question: question("fresh", { text: "Just asked" }) }]);
    expect(within(panel).getByText("Just asked")).toBeInTheDocument();
    expect(within(panel).getByText("New")).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: /1 new/ }));
    expect(within(panel).queryByText("New")).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: /new/ })).not.toBeInTheDocument();
  });

  it("pins a question at once, sends the old pin back, and asks the server", async () => {
    const panel = await renderPresenter(
      view({ questions: [question("a", { status: "highlighted" }), question("b")] }),
    );
    const pinned = () => within(panel).getByRole("region", { name: "On the projector" });
    expect(within(pinned()).getByText("Question a")).toBeInTheDocument();

    fireEvent.click(
      within(panel).getByRole("button", { name: "Pin to the projector: Question b" }),
    );
    expect(within(pinned()).getByText("Question b")).toBeInTheDocument();
    expect(within(pinned()).queryByText("Question a")).not.toBeInTheDocument();
    await waitFor(() => expect(setQuestionStatus).toHaveBeenCalledWith("s1", "b", "pin"));
  });

  it("moves answered and hidden questions out of the list, and back", async () => {
    const panel = await renderPresenter(view({ questions: [question("a"), question("b")] }));
    fireEvent.click(within(panel).getByRole("button", { name: "Mark answered: Question a" }));
    expect(within(panel).getByText("Answered (1)")).toBeInTheDocument();
    await waitFor(() => expect(setQuestionStatus).toHaveBeenCalledWith("s1", "a", "answer"));

    // Another window hid one: the room says so.
    questionUpdate([{ action: "status", questionId: "b", status: "hidden" }]);
    expect(within(panel).getByText("Hidden (1)")).toBeInTheDocument();
    fireEvent.click(
      within(panel).getByRole("button", { name: "Show to students again: Question b" }),
    );
    await waitFor(() => expect(setQuestionStatus).toHaveBeenCalledWith("s1", "b", "restore"));
    expect(within(panel).queryByText("Hidden (1)")).not.toBeInTheDocument();
  });

  it("reloads the real list when a change fails", async () => {
    const panel = await renderPresenter(view({ questions: [question("a")] }));
    jest
      .mocked(setQuestionStatus)
      .mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "Question not found"));
    jest.mocked(getLiveSession).mockResolvedValue(view({ questions: [question("a")] }));
    fireEvent.click(within(panel).getByRole("button", { name: "Hide from students: Question a" }));
    await waitFor(() => expect(getLiveSession).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(panel).queryByText("Hidden (1)")).not.toBeInTheDocument());
  });

  it("opens and closes Q&A for the room, and follows a change from another window", async () => {
    const panel = await renderPresenter();
    const toggle = within(panel).getByRole("switch", { name: /Open for questions/ });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(within(panel).getByText(/Closed\. Students can read the list/)).toBeInTheDocument();
    await waitFor(() => expect(setQaOpen).toHaveBeenCalledWith("s1", false));

    act(() =>
      live.options!.onEvent!({
        type: "qa_toggled",
        seq: 2,
        sessionId: "s1",
        at: Date.now(),
        data: { open: true, shown: true },
      }),
    );
    expect(toggle).toBeChecked();
  });

  it("shows the pinned question on the presenter's own preview", async () => {
    await renderPresenter(
      view({ questions: [question("a", { status: "highlighted", text: "Big one", votes: 3 })] }),
    );
    const preview = screen.getByRole("region", { name: "Current slide" });
    expect(within(preview).getByRole("figure", { name: "Audience question" })).toHaveTextContent(
      "▲ 3 votes",
    );
  });
});

describe("pinned question on the audience screen", () => {
  it("shows the pinned question large with its votes, and follows the room", async () => {
    await renderScreen(view({ questions: [question("a"), question("b", { text: "Other" })] }));
    expect(screen.queryByRole("figure", { name: "Audience question" })).not.toBeInTheDocument();

    questionUpdate([
      {
        action: "status",
        questionId: "a",
        status: "highlighted",
        question: question("a", {
          status: "highlighted",
          votes: 4,
          author: "Mint",
          anonymous: false,
        }),
      },
    ]);
    const card = screen.getByRole("figure", { name: "Audience question" });
    expect(card).toHaveTextContent("Question a");
    expect(card).toHaveTextContent("Mint");
    expect(card).toHaveTextContent("▲ 4 votes");

    questionUpdate([{ action: "votes", questionId: "a", votes: 5 }], 2);
    expect(card).toHaveTextContent("▲ 5 votes");

    questionUpdate([{ action: "status", questionId: "a", status: "hidden" }], 3);
    expect(screen.queryByRole("figure", { name: "Audience question" })).not.toBeInTheDocument();
    expect(screen.queryByText("Other")).not.toBeInTheDocument();
  });

  it("says Anonymous for an anonymous pin", async () => {
    await renderScreen(view({ questions: [question("a", { status: "highlighted" })] }));
    expect(await screen.findByRole("figure", { name: "Audience question" })).toHaveTextContent(
      "Anonymous",
    );
  });
});
