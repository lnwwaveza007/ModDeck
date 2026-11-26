import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { LiveQuestion, SessionResults, SessionSummary } from "@moddeck/shared";
import { ToastProvider } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api/client";
import { deleteSession, getSessionResults, listSessions } from "@/lib/api/sessions";
import { renderWithIntl } from "@/test/render";
import { SessionList } from "./SessionList";
import { SessionResultsView } from "./SessionResultsView";

const mockRouter = { push: jest.fn(), replace: jest.fn() };
const { replace } = mockRouter;

jest.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
}));
jest.mock("@/lib/api/sessions");

const api = {
  list: jest.mocked(listSessions),
  results: jest.mocked(getSessionResults),
  remove: jest.mocked(deleteSession),
};

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "s1",
    status: "ended",
    startedAt: "2026-11-20T02:00:00.000Z",
    endedAt: "2026-11-20T03:25:00.000Z",
    deck: { id: "d1", title: "INT365 W03 Template Syntax", deleted: false },
    participantCount: 42,
    ...overrides,
  };
}

const question = (overrides: Partial<LiveQuestion>): LiveQuestion => ({
  id: "q",
  text: "Question",
  anonymous: false,
  status: "visible",
  createdAt: "2026-11-20T02:10:00.000Z",
  votes: 0,
  ...overrides,
});

const results: SessionResults = {
  session: summary(),
  qaShown: true,
  activities: [
    {
      slidePosition: 1,
      ran: true,
      activity: {
        id: "a1",
        type: "poll",
        prompt: "Which binding is one-way?",
        options: [
          { id: "o1", label: "Interpolation" },
          { id: "o2", label: "ngModel" },
        ],
        allowAnswerChange: false,
        maxEntries: 1,
        imageRef: null,
        imageWithResults: false,
      },
      results: { votes: { o1: 30, o2: 10 }, answered: 40 },
      cloud: null,
    },
    {
      slidePosition: 3,
      ran: true,
      activity: {
        id: "a2",
        type: "word_cloud",
        prompt: "One word for today",
        options: [],
        allowAnswerChange: false,
        maxEntries: 1,
        imageRef: null,
        imageWithResults: false,
      },
      results: null,
      cloud: { words: [{ key: "fun", text: "fun", count: 5 }], entries: 6 },
    },
    {
      slidePosition: 5,
      ran: false,
      activity: {
        id: "a3",
        type: "poll",
        prompt: "Exit poll",
        options: [{ id: "o3", label: "Yes" }],
        allowAnswerChange: false,
        maxEntries: 1,
        imageRef: null,
        imageWithResults: false,
      },
      results: null,
      cloud: null,
    },
  ],
  questions: [
    question({ id: "q1", text: "Anonymous ask", anonymous: true, votes: 7 }),
    question({ id: "q2", text: "Signed ask", author: "Mint", status: "answered", votes: 3 }),
    question({ id: "q3", text: "Rude one", author: "Bot", status: "hidden" }),
  ],
  reactions: [],
};

const withToast = (ui: React.ReactElement) => (
  <ToastProvider closeLabel="Close">{ui}</ToastProvider>
);

beforeEach(() => {
  jest.resetAllMocks();
});

describe("SessionList", () => {
  it("shows the empty state to a host with no sessions", async () => {
    api.list.mockResolvedValue([]);
    renderWithIntl(withToast(<SessionList />), "th");
    expect(await screen.findByRole("heading", { name: "ยังไม่มีเซสชัน" })).toBeInTheDocument();
  });

  it("lists each session with date, deck, participants and duration", async () => {
    api.list.mockResolvedValue([
      summary(),
      summary({
        id: "s2",
        deck: { id: "d2", title: "Old deck", deleted: true },
        endedAt: "2026-11-20T02:40:00.000Z",
        participantCount: 1,
      }),
    ]);
    renderWithIntl(withToast(<SessionList />), "en");

    const first = (
      await screen.findByRole("heading", { name: "INT365 W03 Template Syntax" })
    ).closest("li")!;
    expect(within(first).getByText("1 h 25 min")).toBeInTheDocument();
    expect(within(first).getByText("42 participants")).toBeInTheDocument();
    expect(within(first).getByText(/Nov 20, 2026/)).toBeInTheDocument();
    expect(within(first).getByRole("link", { name: "View results" })).toHaveAttribute(
      "href",
      "/sessions/s1",
    );

    const second = screen.getByRole("heading", { name: "Old deck" }).closest("li")!;
    expect(within(second).getByText("Deck deleted")).toBeInTheDocument();
    expect(within(second).getByText("40 min")).toBeInTheDocument();
    expect(within(second).getByText("1 participant")).toBeInTheDocument();
  });

  it("sends a live session to presenter control and offers no delete", async () => {
    api.list.mockResolvedValue([summary({ status: "live", endedAt: null })]);
    renderWithIntl(withToast(<SessionList />), "en");
    expect(await screen.findByRole("link", { name: "Open presenter control" })).toHaveAttribute(
      "href",
      "/host/s1",
    );
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
  });

  it("deletes a session only after the confirm", async () => {
    api.list.mockResolvedValue([summary()]);
    api.remove.mockResolvedValue(undefined);
    renderWithIntl(withToast(<SessionList />), "en");

    fireEvent.click(await screen.findByRole("button", { name: /Delete the session of INT365/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
    expect(api.remove).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete session" }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith("s1"));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "INT365 W03 Template Syntax" })).toBeNull(),
    );
    expect(screen.getByText("Session deleted")).toBeInTheDocument();
  });

  it("explains a refused delete and keeps the session", async () => {
    api.list.mockResolvedValue([summary()]);
    api.remove.mockRejectedValue(new ApiError(409, "SESSION_LIVE", "still open"));
    renderWithIntl(withToast(<SessionList />), "en");

    fireEvent.click(await screen.findByRole("button", { name: /Delete the session/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete session" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("still live");
    expect(screen.getByRole("heading", { name: "INT365 W03 Template Syntax" })).toBeInTheDocument();
  });

  it("sends a logged-out host to the login page", async () => {
    api.list.mockRejectedValue(new ApiError(401, "UNAUTHORIZED", "login"));
    renderWithIntl(withToast(<SessionList />), "en");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });
});

describe("SessionResultsView", () => {
  it("shows one card per activity, in slide order", async () => {
    api.results.mockResolvedValue(results);
    renderWithIntl(withToast(<SessionResultsView sessionId="s1" />), "en");

    expect(
      await screen.findByRole("heading", { name: "INT365 W03 Template Syntax" }),
    ).toBeInTheDocument();
    const cards = screen.getAllByText(/^Slide \d/).map((el) => el.textContent);
    expect(cards).toEqual(["Slide 2 · Poll", "Slide 4 · Word cloud", "Slide 6 · Poll"]);

    expect(screen.getByText("75% · 30")).toBeInTheDocument();
    expect(screen.getByText("40 answers")).toBeInTheDocument();
    expect(screen.getByText("fun")).toBeInTheDocument();
    expect(screen.getByText(/6 words sent/)).toBeInTheDocument();
    expect(screen.getByText("Not run in this session")).toBeInTheDocument();
  });

  it("lists questions by state with votes, and no name for an anonymous one", async () => {
    api.results.mockResolvedValue(results);
    renderWithIntl(withToast(<SessionResultsView sessionId="s1" />), "en");

    const open = await screen.findByRole("region", { name: "Not answered" });
    expect(within(open).getByText("Anonymous ask")).toBeInTheDocument();
    expect(within(open).getByText("Anonymous")).toBeInTheDocument();
    expect(within(open).getByText("▲ 7 votes")).toBeInTheDocument();

    const answered = screen.getByRole("region", { name: "Answered" });
    expect(within(answered).getByText("Signed ask")).toBeInTheDocument();
    expect(within(answered).getByText("Mint")).toBeInTheDocument();

    const hidden = screen.getByRole("region", { name: "Hidden" });
    expect(within(hidden).getByText("Rude one")).toBeInTheDocument();
  });

  it("shows reaction totals for the session and for each slide", async () => {
    api.results.mockResolvedValue({
      ...results,
      reactions: [
        { slidePosition: 0, counts: { "👏": 12, "❤️": 3 } },
        { slidePosition: 2, counts: { "👏": 5, "🎉": 1 } },
      ],
    });
    renderWithIntl(withToast(<SessionResultsView sessionId="s1" />), "en");

    expect(await screen.findByRole("heading", { name: "Reactions" })).toBeInTheDocument();
    expect(screen.getByText("21 reactions")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "Clap: 17" })).toHaveLength(1);
    expect(screen.getByRole("img", { name: "Laugh: 0" })).toBeInTheDocument();

    const bySlide = screen.getByRole("region", { name: "By slide" });
    const rows = within(bySlide)
      .getAllByRole("listitem")
      .filter((li) => li.parentElement?.parentElement === bySlide);
    expect(rows.map((row) => within(row).getByText(/^Slide/).textContent)).toEqual([
      "Slide 1",
      "Slide 3",
    ]);
    expect(within(rows[0]!).getByRole("img", { name: "Clap: 12" })).toBeInTheDocument();
    expect(within(rows[0]!).getByRole("img", { name: "Love it: 3" })).toBeInTheDocument();
    expect(within(rows[1]!).getByRole("img", { name: "Celebrate: 1" })).toBeInTheDocument();
    expect(within(rows[1]!).queryByRole("img", { name: /Love it/ })).not.toBeInTheDocument();
  });

  it("says when nobody sent a reaction", async () => {
    api.results.mockResolvedValue(results);
    renderWithIntl(withToast(<SessionResultsView sessionId="s1" />), "en");
    expect(await screen.findByText("No reactions were sent.")).toBeInTheDocument();
  });

  it("says when Q&A was off", async () => {
    api.results.mockResolvedValue({ ...results, qaShown: false, questions: [] });
    renderWithIntl(withToast(<SessionResultsView sessionId="s1" />), "en");
    expect(await screen.findByText("Q&A was off in this session.")).toBeInTheDocument();
  });

  it("sends a live session back to presenter control", async () => {
    api.results.mockRejectedValue(new ApiError(409, "SESSION_LIVE", "open"));
    renderWithIntl(withToast(<SessionResultsView sessionId="s1" />), "en");
    expect(await screen.findByRole("link", { name: "Open presenter control" })).toHaveAttribute(
      "href",
      "/host/s1",
    );
  });

  it("says when the session does not exist", async () => {
    api.results.mockRejectedValue(new ApiError(404, "NOT_FOUND", "gone"));
    renderWithIntl(withToast(<SessionResultsView sessionId="s1" />), "en");
    expect(await screen.findByRole("heading", { name: "Session not found" })).toBeInTheDocument();
  });

  it("deletes the session after the confirm and goes back to the list", async () => {
    api.results.mockResolvedValue(results);
    api.remove.mockResolvedValue(undefined);
    renderWithIntl(withToast(<SessionResultsView sessionId="s1" />), "en");

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete session" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sessions"));
    expect(api.remove).toHaveBeenCalledWith("s1");
  });
});
