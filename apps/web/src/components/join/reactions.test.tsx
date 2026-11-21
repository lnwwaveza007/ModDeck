import { act, fireEvent, screen, within } from "@testing-library/react";
import { REACTION_INTERVAL_MS, type ParticipantMe, type RoomEvent } from "@moddeck/shared";
import { getParticipantMe } from "@/lib/api/participants";
import type { LiveConnectionOptions } from "@/lib/realtime/live-connection";
import { renderWithIntl } from "@/test/render";
import { LiveSession } from "./LiveSession";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));
jest.mock("@/lib/api/participants");

// The live screen's socket: the test plays the server through `live.options`.
const live: {
  options?: LiveConnectionOptions;
  connect: jest.Mock;
  close: jest.Mock;
  react: jest.Mock;
} = { connect: jest.fn(), close: jest.fn(), react: jest.fn(() => true) };
jest.mock("@/lib/realtime/live-connection", () => ({
  LiveConnection: jest.fn().mockImplementation((options: LiveConnectionOptions) => {
    live.options = options;
    return { connect: live.connect, close: live.close, react: live.react };
  }),
}));

const me = (overrides: Partial<ParticipantMe> = {}): ParticipantMe => ({
  participantId: "p1",
  sessionId: "s1",
  loginType: "guest",
  nickname: "Ploy",
  title: "INT365 Software Engineering",
  status: "live",
  slideCount: 20,
  currentSlide: { id: "slide-5", index: 4 },
  currentActivity: null,
  reactionsEnabled: true,
  qaEnabled: true,
  anonymousAllowed: true,
  ...overrides,
});

function roomEvent(event: Omit<RoomEvent, "seq" | "sessionId" | "at">) {
  act(() => live.options!.onEvent!({ seq: 1, sessionId: "s1", at: 0, ...event } as RoomEvent));
}

async function renderLive(value = me()) {
  jest.mocked(getParticipantMe).mockResolvedValue(value);
  renderWithIntl(<LiveSession sessionId="s1" />, "en");
  await screen.findByText("INT365 Software Engineering");
  act(() => live.options!.onStatus!("online"));
}

const bar = () => screen.queryByRole("group", { name: "Send a reaction" });

beforeEach(() => {
  jest.clearAllMocks();
  live.react.mockReturnValue(true);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("reaction bar", () => {
  it("shows the five emojis, and a tap sends one reaction", async () => {
    await renderLive();
    const buttons = within(bar()!).getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Clap",
      "Love it",
      "Laugh",
      "Wow",
      "Celebrate",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Love it" }));
    expect(live.react).toHaveBeenCalledTimes(1);
    expect(live.react).toHaveBeenCalledWith("❤️");
  });

  it("rests for a second after a tap, like the server's limit", async () => {
    await renderLive();
    jest.useFakeTimers();

    fireEvent.click(screen.getByRole("button", { name: "Clap" }));
    fireEvent.click(screen.getByRole("button", { name: "Clap" }));
    fireEvent.click(screen.getByRole("button", { name: "Wow" }));
    expect(live.react).toHaveBeenCalledTimes(1);
    // Still focusable while it rests, so a keyboard user keeps their place.
    expect(screen.getByRole("button", { name: "Clap" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Clap" })).toBeEnabled();

    act(() => jest.advanceTimersByTime(REACTION_INTERVAL_MS));
    fireEvent.click(screen.getByRole("button", { name: "Wow" }));
    expect(live.react).toHaveBeenCalledTimes(2);
    expect(live.react).toHaveBeenLastCalledWith("😮");
  });

  it("does not rest when the tap could not be sent", async () => {
    await renderLive();
    live.react.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Clap" }));
    fireEvent.click(screen.getByRole("button", { name: "Clap" }));
    expect(live.react).toHaveBeenCalledTimes(2);
  });

  it("is disabled while the connection is down", async () => {
    await renderLive();
    act(() => live.options!.onStatus!("reconnecting"));
    expect(screen.getByRole("button", { name: "Clap" })).toBeDisabled();
    act(() => live.options!.onStatus!("online"));
    expect(screen.getByRole("button", { name: "Clap" })).toBeEnabled();
  });

  it("hides when the host turns reactions off, and comes back when they turn them on", async () => {
    await renderLive();
    roomEvent({ type: "reactions_toggled", data: { enabled: false } });
    expect(bar()).toBeNull();
    roomEvent({ type: "reactions_toggled", data: { enabled: true } });
    expect(bar()).toBeVisible();
  });

  it("starts hidden when reactions are already off", async () => {
    await renderLive(me({ reactionsEnabled: false }));
    expect(bar()).toBeNull();
  });
});
