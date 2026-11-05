import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ActivityRunDto, LiveSessionView, LiveSlide, RoomEvent } from "@moddeck/shared";
import { ApiError } from "@/lib/api/client";
import { actOnActivity, editActivityWording, getLiveSession, moveToSlide } from "@/lib/api/live";
import { endSession, getSession } from "@/lib/api/sessions";
import type { LiveConnectionOptions } from "@/lib/realtime/live-connection";
import { renderWithIntl } from "@/test/render";
import { ToastProvider } from "@/components/ui/Toast";
import { AudienceScreen } from "./AudienceScreen";
import { EndSessionButton } from "./EndSession";
import { PresenterControl } from "./PresenterControl";

const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock("next/navigation", () => ({ useRouter: () => mockRouter }));
jest.mock("@/lib/api/live");
jest.mock("@/lib/api/sessions");
jest.mock("qrcode", () => ({ toDataURL: jest.fn().mockResolvedValue("data:image/png;base64,") }));

// The host socket: the test plays the server through `live.options`.
const live: { options?: LiveConnectionOptions; connect: jest.Mock; close: jest.Mock } = {
  connect: jest.fn(),
  close: jest.fn(),
};
jest.mock("@/lib/realtime/live-connection", () => ({
  LiveConnection: jest.fn().mockImplementation((options: LiveConnectionOptions) => {
    live.options = options;
    return { connect: live.connect, close: live.close };
  }),
}));

const api = {
  view: jest.mocked(getLiveSession),
  move: jest.mocked(moveToSlide),
  act: jest.mocked(actOnActivity),
  edit: jest.mocked(editActivityWording),
  session: jest.mocked(getSession),
  end: jest.mocked(endSession),
};

const content = (id: string, position: number): LiveSlide => ({
  id,
  position,
  kind: "content",
  elements: [],
  activity: null,
});

const poll: LiveSlide = {
  id: "slide-poll",
  position: 1,
  kind: "poll",
  elements: [],
  activity: {
    id: "act-poll",
    type: "poll",
    prompt: "Which one?",
    options: [
      { id: "o1", label: "Alpha" },
      { id: "o2", label: "Beta" },
    ],
  },
};

const view = (overrides: Partial<LiveSessionView> = {}): LiveSessionView => ({
  id: "s1",
  deckId: "d1",
  pin: "482914",
  status: "live",
  title: "INT365 Reactive Forms",
  joinUrl: "http://localhost:3000/j/482914",
  startedAt: new Date(Date.now() - 65_000).toISOString(),
  serverNow: Date.now(),
  currentSlideId: "slide-0",
  slides: [content("slide-0", 0), poll, content("slide-2", 2)],
  runs: [],
  participantCount: 12,
  ...overrides,
});

const run = (state: ActivityRunDto["state"], endsAt: number | null = null): ActivityRunDto => ({
  activityId: "act-poll",
  activityRunId: "run-1",
  state,
  endsAt,
});

function roomEvent<T extends RoomEvent["type"]>(
  type: T,
  data: Extract<RoomEvent, { type: T }>["data"],
  seq = 1,
) {
  act(() =>
    live.options?.onEvent?.({ type, seq, sessionId: "s1", at: Date.now(), data } as RoomEvent),
  );
}

const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    fireEvent.keyDown(document.body, { key, ...init });
  });

async function renderPresenter(value = view()) {
  api.view.mockResolvedValue(value);
  renderWithIntl(
    <ToastProvider closeLabel="Close">
      <PresenterControl sessionId="s1" />
    </ToastProvider>,
    "en",
  );
  await screen.findByRole("heading", { name: "INT365 Reactive Forms" });
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  live.options = undefined;
  api.session.mockResolvedValue({
    id: "s1",
    pin: "482914",
    status: "live",
    participantCount: 12,
    deck: { title: "INT365 Reactive Forms" },
    joinUrl: "http://localhost:3000/j/482914",
    serverNow: Date.now(),
  });
  api.move.mockImplementation(async (_s, currentSlideId) => ({ currentSlideId, index: 0 }));
});

describe("PresenterControl", () => {
  it("shows the session, current and next slide, and the participant count", async () => {
    await renderPresenter();
    expect(screen.getByText("PIN 482 914")).toBeInTheDocument();
    expect(screen.getByText("12 participants")).toBeInTheDocument();
    expect(screen.getByText("Now showing · slide 1 of 3")).toBeInTheDocument();
    expect(screen.getByText(/Slide 2$/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open audience screen" })).toHaveAttribute(
      "href",
      "/screen/s1",
    );
    // The host socket, not a student one.
    await waitFor(() => expect(live.options).toMatchObject({ sessionId: "s1", role: "host" }));
  });

  it("moves slides with the arrows, space and the slide strip", async () => {
    await renderPresenter(view({ currentSlideId: "slide-0" }));
    press("ArrowRight"); // the first press only closes the lobby join screen
    expect(api.move).not.toHaveBeenCalled();
    press("ArrowRight");
    expect(api.move).toHaveBeenLastCalledWith("s1", "slide-poll");
    expect(screen.getByText("Now showing · slide 2 of 3")).toBeInTheDocument();

    await waitFor(() => expect(api.move).toHaveBeenCalledTimes(1));
    press(" ");
    await waitFor(() => expect(api.move).toHaveBeenLastCalledWith("s1", "slide-2"));
    press("ArrowLeft");
    await waitFor(() => expect(api.move).toHaveBeenLastCalledWith("s1", "slide-poll"));

    const strip = screen.getByRole("navigation", { name: "Slides" });
    fireEvent.click(within(strip).getByRole("button", { name: "Go to slide 1" }));
    await waitFor(() => expect(api.move).toHaveBeenLastCalledWith("s1", "slide-0"));
    expect(within(strip).getByRole("button", { name: "Go to slide 1" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("says when the join screen is up, and Next shows the slide under it", async () => {
    await renderPresenter();
    expect(screen.getByText("· join screen is showing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Join screen/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: /Show slide/ }));
    expect(api.move).not.toHaveBeenCalled();
    expect(screen.queryByText("· join screen is showing")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    expect(api.move).toHaveBeenLastCalledWith("s1", "slide-poll");
  });

  it("hides the PIN bar from its button", async () => {
    await renderPresenter();
    const button = screen.getByRole("button", { name: /PIN bar/ });
    expect(button).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(JSON.parse(localStorage.getItem("moddeck:screen:s1")!)).toMatchObject({
      joinBar: false,
    });
  });

  it("follows a slide change made in another window", async () => {
    await renderPresenter();
    await waitFor(() => expect(live.options).toBeDefined());
    roomEvent("slide_changed", { slideId: "slide-2", index: 2 });
    expect(screen.getByText("Now showing · slide 3 of 3")).toBeInTheDocument();
  });

  it("does not start an activity when its slide is shown", async () => {
    await renderPresenter(view({ currentSlideId: "slide-poll" }));
    expect(screen.getByText("Not started")).toBeInTheDocument();
    expect(api.act).not.toHaveBeenCalled();
  });

  it("starts, stops, shows results and reopens from one screen", async () => {
    await renderPresenter(view({ currentSlideId: "slide-poll" }));
    const controls = screen.getByRole("region", { name: "Activity controls" });

    api.act.mockResolvedValueOnce(run("live"));
    fireEvent.click(within(controls).getByRole("button", { name: /^Start/ }));
    await waitFor(() =>
      expect(api.act).toHaveBeenLastCalledWith("s1", "act-poll", { action: "start" }),
    );
    expect(await within(controls).findByText("Open")).toBeInTheDocument();

    api.act.mockResolvedValueOnce(run("closed"));
    fireEvent.click(within(controls).getByRole("button", { name: /^Stop/ }));
    expect(await within(controls).findByText("Closed")).toBeInTheDocument();

    api.act.mockResolvedValueOnce(run("results_shown"));
    fireEvent.click(within(controls).getByRole("button", { name: /^Show results/ }));
    expect(await within(controls).findByText("Results shown")).toBeInTheDocument();

    api.act.mockResolvedValueOnce(run("live"));
    fireEvent.click(within(controls).getByRole("button", { name: /^Reopen/ }));
    await waitFor(() =>
      expect(api.act).toHaveBeenLastCalledWith("s1", "act-poll", { action: "reopen" }),
    );
    expect(await within(controls).findByText("Open")).toBeInTheDocument();
  });

  it("starts with a countdown and shows the time left", async () => {
    await renderPresenter(view({ currentSlideId: "slide-poll" }));
    fireEvent.change(screen.getByLabelText("Timer"), { target: { value: "60" } });
    api.act.mockResolvedValueOnce(run("live", Date.now() + 60_000));
    fireEvent.click(screen.getByRole("button", { name: /^Start/ }));
    await waitFor(() =>
      expect(api.act).toHaveBeenLastCalledWith("s1", "act-poll", {
        action: "start",
        durationSeconds: 60,
      }),
    );
    expect(await screen.findByRole("timer")).toHaveTextContent(/^(1:00|0:59)$/);
  });

  it("runs the activity with A and S", async () => {
    await renderPresenter(view({ currentSlideId: "slide-poll" }));
    api.act.mockResolvedValueOnce(run("live"));
    press("a");
    await waitFor(() =>
      expect(api.act).toHaveBeenLastCalledWith("s1", "act-poll", { action: "start" }),
    );
    const controls = screen.getByRole("region", { name: "Activity controls" });
    await within(controls).findByText("Open");
    api.act.mockResolvedValueOnce(run("results_shown"));
    press("s");
    await waitFor(() =>
      expect(api.act).toHaveBeenLastCalledWith("s1", "act-poll", { action: "show_results" }),
    );
  });

  it("shows the state another window or the timer set", async () => {
    await renderPresenter(view({ currentSlideId: "slide-poll", runs: [run("live")] }));
    await waitFor(() => expect(live.options).toBeDefined());
    roomEvent("activity_state", run("closed"));
    expect(
      within(screen.getByRole("region", { name: "Activity controls" })).getByText("Closed"),
    ).toBeInTheDocument();
  });

  it("says so when the activity changed first", async () => {
    await renderPresenter(view({ currentSlideId: "slide-poll", runs: [run("live")] }));
    api.act.mockRejectedValueOnce(new ApiError(409, "INVALID_TRANSITION", "no"));
    fireEvent.click(screen.getByRole("button", { name: /^Stop/ }));
    expect(
      await screen.findByText(
        "The activity changed in the meantime. The screen now shows its state.",
      ),
    ).toBeInTheDocument();
  });

  it("edits the wording of a live activity, keeping its options", async () => {
    await renderPresenter(view({ currentSlideId: "slide-poll", runs: [run("live")] }));
    api.edit.mockResolvedValueOnce({ ...poll.activity!, prompt: "Which one, really?" });
    fireEvent.click(screen.getByRole("button", { name: "Edit wording" }));
    const dialog = screen.getByRole("dialog", { name: "Edit wording" });
    fireEvent.change(within(dialog).getByLabelText("Question"), {
      target: { value: "Which one, really?" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.edit).toHaveBeenCalledWith("d1", "slide-poll", {
        prompt: "Which one, really?",
        options: [
          { id: "o1", label: "Alpha" },
          { id: "o2", label: "Beta" },
        ],
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("does not move the slide while the host types", async () => {
    await renderPresenter(view({ currentSlideId: "slide-poll" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit wording" }));
    const question = screen.getByLabelText("Question");
    fireEvent.keyDown(question, { key: "ArrowRight" });
    fireEvent.keyDown(question, { key: " " });
    expect(api.move).not.toHaveBeenCalled();
  });

  it("lists the shortcuts with ?", async () => {
    await renderPresenter();
    press("?");
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  });

  it("ends the session as soon as the 2 s hold completes, with no undo window", async () => {
    await renderPresenter();
    api.end.mockResolvedValue({ status: "ended" });
    jest.useFakeTimers();
    try {
      fireEvent.pointerDown(screen.getByRole("button", { name: "End Session" }));
      act(() => jest.advanceTimersByTime(2000));
    } finally {
      jest.useRealTimers();
    }
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith("/sessions/s1"));
    expect(api.end).toHaveBeenCalledWith("s1");
    expect(screen.queryByText(/undo/i)).not.toBeInTheDocument();
  });

  it("says so and stays when the end fails", async () => {
    await renderPresenter();
    api.end.mockRejectedValue(new ApiError(0, "NETWORK_ERROR", "offline"));
    jest.useFakeTimers();
    try {
      fireEvent.pointerDown(screen.getByRole("button", { name: "End Session" }));
      act(() => jest.advanceTimersByTime(2000));
    } finally {
      jest.useRealTimers();
    }
    expect(
      await screen.findByText("No connection to ModDeck. Check your internet."),
    ).toBeInTheDocument();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "End Session" })).toBeEnabled();
  });
});

describe("AudienceScreen", () => {
  async function renderScreen(value = view()) {
    api.view.mockResolvedValue(value);
    renderWithIntl(<AudienceScreen sessionId="s1" />, "en");
    await screen.findByText("482 914");
  }

  it("shows the current slide with the join PIN and follows the room", async () => {
    await renderScreen(view({ currentSlideId: "slide-poll" }));
    expect(screen.getByText("Which one?")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    await waitFor(() => expect(live.options).toMatchObject({ role: "host" }));

    roomEvent("slide_changed", { slideId: "slide-2", index: 2 });
    expect(screen.queryByText("Which one?")).not.toBeInTheDocument();
  });

  it("shows the activity state and the new wording", async () => {
    await renderScreen(view({ currentSlideId: "slide-poll" }));
    await waitFor(() => expect(live.options).toBeDefined());
    expect(screen.getByText("Starting soon")).toBeInTheDocument();
    roomEvent("activity_state", run("live", Date.now() + 30_000), 1);
    expect(screen.getByText("Open")).toBeInTheDocument();
    roomEvent(
      "activity_edited",
      { activityId: "act-poll", prompt: "Fixed?", options: poll.activity!.options },
      2,
    );
    expect(screen.getByText("Fixed?")).toBeInTheDocument();
  });

  it("works from the keyboard on a single display, with the O overlay", async () => {
    await renderScreen();
    press("ArrowRight"); // closes the lobby join screen
    press("ArrowRight");
    expect(api.move).toHaveBeenLastCalledWith("s1", "slide-poll");

    expect(
      screen.queryByRole("complementary", { name: "Presenter overlay" }),
    ).not.toBeInTheDocument();
    press("o");
    const overlay = screen.getByRole("complementary", { name: "Presenter overlay" });
    expect(within(overlay).getByText(/Slide 2\/3/)).toBeInTheDocument();
    expect(within(overlay).getByText("12 participants")).toBeInTheDocument();
    expect(within(overlay).getByText("Next: slide 3")).toBeInTheDocument();
    press("O");
    expect(
      screen.queryByRole("complementary", { name: "Presenter overlay" }),
    ).not.toBeInTheDocument();

    // The poll is on screen now: A starts it from here too.
    api.act.mockResolvedValueOnce(run("live"));
    press("a");
    await waitFor(() =>
      expect(api.act).toHaveBeenLastCalledWith("s1", "act-poll", { action: "start" }),
    );
    expect(await screen.findByText("Open")).toBeInTheDocument();
  });

  it("closes the O overlay when the session ends", async () => {
    await renderScreen();
    await waitFor(() => expect(live.options).toBeDefined());
    press("o");
    expect(screen.getByRole("complementary", { name: "Presenter overlay" })).toBeInTheDocument();
    roomEvent("session_ended", { reason: "host" });
    expect(screen.getByText("Session ended. Thanks for joining.")).toBeInTheDocument();
    expect(
      screen.queryByRole("complementary", { name: "Presenter overlay" }),
    ).not.toBeInTheDocument();
  });

  it("opens on the join screen, with the PIN, QR code and joined count", async () => {
    await renderScreen();
    expect(screen.getByText("Enter the PIN")).toBeInTheDocument();
    expect(await screen.findByAltText("QR code to join session 482914")).toBeInTheDocument();
    expect(screen.getByText("localhost:3000")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("shows the first slide on Next, and only then moves the room", async () => {
    await renderScreen();
    press(" ");
    expect(screen.queryByText("Enter the PIN")).not.toBeInTheDocument();
    expect(api.move).not.toHaveBeenCalled();
    expect(screen.getByText("482 914")).toBeInTheDocument(); // the corner bar
    press(" ");
    expect(api.move).toHaveBeenLastCalledWith("s1", "slide-poll");
  });

  it("closes the join screen when the room moves, and does not bring it back", async () => {
    await renderScreen();
    await waitFor(() => expect(live.options).toBeDefined());
    roomEvent("slide_changed", { slideId: "slide-2", index: 2 });
    expect(screen.queryByText("Enter the PIN")).not.toBeInTheDocument();
    roomEvent("slide_changed", { slideId: "slide-0", index: 0 }, 2);
    expect(screen.queryByText("Enter the PIN")).not.toBeInTheDocument();
  });

  it("starts without the join screen when the room is past the first slide", async () => {
    await renderScreen(view({ currentSlideId: "slide-2" }));
    expect(screen.queryByText("Enter the PIN")).not.toBeInTheDocument();
  });

  it("toggles the join screen with J and the PIN bar with H", async () => {
    await renderScreen(view({ currentSlideId: "slide-2" }));
    press("j");
    expect(screen.getByText("Enter the PIN")).toBeInTheDocument();
    press("j");
    expect(screen.queryByText("Enter the PIN")).not.toBeInTheDocument();
    expect(screen.getByText("482 914")).toBeInTheDocument();
    press("h");
    expect(screen.queryByText("482 914")).not.toBeInTheDocument();
    press("h");
    expect(screen.getByText("482 914")).toBeInTheDocument();
  });

  it("blanks the screen with B", async () => {
    await renderScreen();
    press("b");
    expect(screen.getByText("The screen is blank.")).toBeInTheDocument();
    expect(screen.queryByText("482 914")).not.toBeInTheDocument();
    press("b");
    expect(screen.getByText("482 914")).toBeInTheDocument();
  });

  it("recovers the slide, activity state and layers after a refresh", async () => {
    const value = view({ currentSlideId: "slide-poll", runs: [run("live")] });
    await renderScreen(value);
    press("h");
    press("b");
    cleanup();

    api.view.mockResolvedValue(value);
    renderWithIntl(<AudienceScreen sessionId="s1" />, "en");
    expect(await screen.findByText("The screen is blank.")).toBeInTheDocument();
    press("b");
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Which one?")).toBeInTheDocument();
    expect(screen.queryByText("482 914")).not.toBeInTheDocument();
  });

  it("follows a layer change made in another window", async () => {
    await renderScreen(view({ currentSlideId: "slide-2" }));
    act(() => {
      localStorage.setItem("moddeck:screen:s1", JSON.stringify({ join: true }));
      window.dispatchEvent(new StorageEvent("storage", { key: "moddeck:screen:s1" }));
    });
    expect(screen.getByText("Enter the PIN")).toBeInTheDocument();
  });

  it("shows the ended card after a refresh of an ended session", async () => {
    api.view.mockResolvedValue(view({ status: "ended" }));
    renderWithIntl(<AudienceScreen sessionId="s1" />, "en");
    expect(await screen.findByText("Session ended. Thanks for joining.")).toBeInTheDocument();
    expect(screen.getByText("INT365 Reactive Forms")).toBeInTheDocument();
    expect(screen.getByText("12 people joined")).toBeInTheDocument();
  });

  it("shows empty poll results until answers can be counted", async () => {
    await renderScreen(view({ currentSlideId: "slide-poll", runs: [run("results_shown")] }));
    expect(screen.getByText("No votes yet")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getAllByText("0%")).toHaveLength(2);
  });

  it("shows the reconnecting status only when the connection is lost", async () => {
    await renderScreen(view({ currentSlideId: "slide-2" }));
    await waitFor(() => expect(live.options).toBeDefined());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    act(() => live.options?.onStatus?.("reconnecting"));
    expect(screen.getByRole("status")).toHaveTextContent("Reconnecting…");
    act(() => live.options?.onStatus?.("online"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("asks for the host login when the session is not reachable", async () => {
    api.view.mockRejectedValue(new ApiError(401, "UNAUTHORIZED", "no"));
    renderWithIntl(<AudienceScreen sessionId="s1" />, "en");
    expect(
      await screen.findByText(
        "Open the audience screen from presenter control, signed in as the host.",
      ),
    ).toBeInTheDocument();
  });
});

describe("EndSessionButton", () => {
  afterEach(() => jest.useRealTimers());

  it("shows the hold, ends only after 2 s and does nothing on a click", () => {
    jest.useFakeTimers();
    const onEnd = jest.fn();
    renderWithIntl(<EndSessionButton onEnd={onEnd} />, "en");
    const button = screen.getByRole("button", { name: "End Session" });

    fireEvent.pointerDown(button);
    expect(button).toHaveTextContent("Keep holding…");
    fireEvent.pointerUp(button);
    expect(button).toHaveTextContent("End Session");
    act(() => jest.advanceTimersByTime(3000));
    expect(onEnd).not.toHaveBeenCalled();

    fireEvent.pointerDown(button);
    act(() => jest.advanceTimersByTime(2000));
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(button).toHaveTextContent("End Session");
  });
});
