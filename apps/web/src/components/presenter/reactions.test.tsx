import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  REACTION_MAX_ON_SCREEN,
  type LiveSessionView,
  type ReactionBurst,
  type RoomEvent,
} from "@moddeck/shared";
import { ApiError } from "@/lib/api/client";
import { getLiveSession, setReactionsEnabled } from "@/lib/api/live";
import { getSession } from "@/lib/api/sessions";
import type { LiveConnectionOptions } from "@/lib/realtime/live-connection";
import { renderWithIntl } from "@/test/render";
import { ToastProvider } from "@/components/ui/Toast";
import { AudienceScreen } from "./AudienceScreen";
import { PresenterControl } from "./PresenterControl";
import { REACTION_FLOAT_MS, ReactionLayer, pickReactions } from "./ReactionLayer";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));
jest.mock("@/lib/api/live");
jest.mock("@/lib/api/sessions");
jest.mock("qrcode", () => ({ toDataURL: jest.fn().mockResolvedValue("data:image/png;base64,") }));

// The host socket: the test plays the server through `live.options`.
const live: { options?: LiveConnectionOptions } = {};
jest.mock("@/lib/realtime/live-connection", () => ({
  LiveConnection: jest.fn().mockImplementation((options: LiveConnectionOptions) => {
    live.options = options;
    return { connect: jest.fn(), close: jest.fn() };
  }),
}));

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
  participantCount: 12,
  ...overrides,
});

const burst = (counts: ReactionBurst["counts"]) =>
  act(() => live.options!.onReactionBurst!({ sessionId: "s1", counts }));

const floating = () => screen.queryByTestId("reaction-layer")?.querySelectorAll(".reaction-rise");

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
});

describe("pickReactions", () => {
  it("draws every tap of a small burst", () => {
    expect(pickReactions({ "👏": 2, "🎉": 1 }, 30)).toEqual(["👏", "👏", "🎉"]);
  });

  it("caps a big burst and still shows the rare emoji", () => {
    const picked = pickReactions({ "👏": 297, "❤️": 3 }, 30);
    expect(picked.length).toBeLessThanOrEqual(30);
    expect(picked).toContain("❤️");
    expect(picked.filter((emoji) => emoji === "👏").length).toBeGreaterThan(20);
  });

  it("draws nothing without room", () => {
    expect(pickReactions({ "👏": 5 }, 0)).toEqual([]);
  });
});

describe("ReactionLayer", () => {
  it("floats each burst, never more than the cap at once, and clears them after", () => {
    jest.useFakeTimers();
    let listener: ((burst: ReactionBurst) => void) | undefined;
    const subscribe = (next: (burst: ReactionBurst) => void) => {
      listener = next;
      return () => (listener = undefined);
    };
    const { unmount } = render(<ReactionLayer subscribe={subscribe} />);
    const layer = screen.getByTestId("reaction-layer");
    expect(layer).toHaveAttribute("aria-hidden", "true");

    act(() => listener!({ sessionId: "s1", counts: { "👏": 3 } }));
    expect(layer.querySelectorAll(".reaction-rise")).toHaveLength(3);
    act(() => listener!({ sessionId: "s1", counts: { "🎉": 300 } }));
    expect(layer.querySelectorAll(".reaction-rise")).toHaveLength(REACTION_MAX_ON_SCREEN);

    act(() => jest.advanceTimersByTime(REACTION_FLOAT_MS * 2));
    expect(layer.querySelectorAll(".reaction-rise")).toHaveLength(0);
    unmount();
    expect(listener).toBeUndefined();
    jest.useRealTimers();
  });
});

describe("audience screen", () => {
  it("floats the room's reactions over the slide, and stops when the host turns them off", async () => {
    jest.mocked(getLiveSession).mockResolvedValue(view());
    renderWithIntl(<AudienceScreen sessionId="s1" />, "en");
    await waitFor(() => expect(live.options).toBeDefined());
    await screen.findByTestId("reaction-layer");

    burst({ "👏": 2, "😂": 1 });
    expect(floating()).toHaveLength(3);
    expect(screen.getByTestId("reaction-layer")).toHaveTextContent("👏👏😂");

    act(() =>
      live.options!.onEvent!({
        type: "reactions_toggled",
        seq: 1,
        sessionId: "s1",
        at: 0,
        data: { enabled: false },
      } as RoomEvent),
    );
    expect(screen.queryByTestId("reaction-layer")).toBeNull();
  });

  it("has no reaction layer when the session starts with reactions off", async () => {
    jest.mocked(getLiveSession).mockResolvedValue(view({ reactionsEnabled: false }));
    renderWithIntl(<AudienceScreen sessionId="s1" />, "en");
    await waitFor(() => expect(live.options).toBeDefined());
    expect(screen.queryByTestId("reaction-layer")).toBeNull();
  });
});

describe("presenter control", () => {
  async function renderPresenter(value = view()) {
    jest.mocked(getLiveSession).mockResolvedValue(value);
    renderWithIntl(
      <ToastProvider closeLabel="Close">
        <PresenterControl sessionId="s1" />
      </ToastProvider>,
      "en",
    );
    await screen.findByRole("heading", { name: "INT365 Reactive Forms" });
    return screen.getByRole("switch", { name: "Live reactions" });
  }

  it("turns reactions off and on for the room", async () => {
    jest
      .mocked(setReactionsEnabled)
      .mockImplementation(async (_id, reactionsEnabled) => ({ reactionsEnabled }));
    const toggle = await renderPresenter();
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await waitFor(() => expect(setReactionsEnabled).toHaveBeenLastCalledWith("s1", false));

    fireEvent.click(toggle);
    await waitFor(() => expect(setReactionsEnabled).toHaveBeenLastCalledWith("s1", true));
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("shows the reactions on its own preview of the slide too", async () => {
    await renderPresenter();
    await waitFor(() => expect(live.options).toBeDefined());
    burst({ "❤️": 1 });
    expect(floating()).toHaveLength(1);
  });

  it("puts the switch back and says so when the change fails", async () => {
    jest.mocked(setReactionsEnabled).mockRejectedValue(new ApiError(0, "NETWORK_ERROR", "x"));
    const toggle = await renderPresenter();

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(await screen.findByText("No connection to ModDeck. Check your internet.")).toBeVisible();
  });
});
