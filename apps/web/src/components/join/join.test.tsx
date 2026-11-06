import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { JoinResult, ParticipantMe, PinInfo } from "@moddeck/shared";
import { ApiError } from "@/lib/api/client";
import { getParticipantMe, getPinInfo, joinSession, kmuttLoginUrl } from "@/lib/api/participants";
import type { LiveConnectionOptions } from "@/lib/realtime/live-connection";
import { renderWithIntl } from "@/test/render";
import { JoinFlow } from "./JoinFlow";
import { LiveSession } from "./LiveSession";

// One object for every render, like the real app router.
const mockRouter = { push: jest.fn(), replace: jest.fn() };
const { replace } = mockRouter;

jest.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
}));
jest.mock("@/lib/api/participants");

// The live screen's socket: the test plays the server through `live.options`.
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
  info: jest.mocked(getPinInfo),
  join: jest.mocked(joinSession),
  me: jest.mocked(getParticipantMe),
  loginUrl: jest.mocked(kmuttLoginUrl),
};

const PIN = "482914";

const info = (overrides: Partial<PinInfo> = {}): PinInfo => ({
  status: "live",
  title: "INT365 Software Engineering",
  hostName: "Somchai Jaidee",
  participantCount: 87,
  requireLogin: false,
  joined: null,
  ...overrides,
});

const joined: JoinResult = {
  participantId: "p1",
  sessionId: "s1",
  loginType: "guest",
  nickname: "Ploy",
};

const apiError = (status: number, code: string, details?: Record<string, unknown>) =>
  new ApiError(status, code, code, details);

beforeEach(() => {
  jest.clearAllMocks();
  api.loginUrl.mockImplementation((pin) => `/api/auth/login?returnTo=/j/${pin}?sso=1`);
  localStorage.clear();
});

describe("JoinFlow", () => {
  it("shows the class, both ways to join and the student ID notice", async () => {
    api.info.mockResolvedValue(info());
    renderWithIntl(<JoinFlow pin={PIN} />);

    expect(
      await screen.findByRole("heading", { name: "INT365 Software Engineering" }),
    ).toBeVisible();
    expect(screen.getByText("PIN 482 914")).toBeVisible();
    expect(screen.getByText("กำลังสด · ผู้เข้าร่วม 87 คน")).toBeVisible();
    expect(screen.getByRole("button", { name: "เข้าสู่ระบบด้วยบัญชี KMUTT" })).toBeVisible();
    expect(screen.getByRole("button", { name: "เข้าร่วมแบบ Guest (ตั้งชื่อเล่น)" })).toBeVisible();
    expect(screen.getByText(/คำตอบ Poll จะบันทึกพร้อมรหัสนักศึกษา/)).toBeVisible();
  });

  it("joins as a guest after checking the nickname rules", async () => {
    api.info.mockResolvedValue(info());
    api.join.mockResolvedValue(joined);
    renderWithIntl(<JoinFlow pin={PIN} />, "en");

    fireEvent.click(await screen.findByRole("button", { name: /Join as a guest/ }));
    const input = screen.getByRole("textbox", { name: "Nickname" });
    fireEvent.change(input, { target: { value: "P" } });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Use at least 2 characters.");
    expect(api.join).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "  Ploy  " } });
    expect(screen.getByText("4/20")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/s/s1"));
    expect(api.join).toHaveBeenCalledWith(PIN, "Ploy");
  });

  it("asks for another nickname when it is taken, and keeps the typed name", async () => {
    api.info.mockResolvedValue(info());
    api.join.mockRejectedValue(apiError(409, "NICKNAME_TAKEN"));
    renderWithIntl(<JoinFlow pin={PIN} />, "en");

    fireEvent.click(await screen.findByRole("button", { name: /Join as a guest/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nickname" }), {
      target: { value: "Ploy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("already uses this name");
    expect(screen.getByRole("textbox", { name: "Nickname" })).toHaveValue("Ploy");
    expect(localStorage.getItem("moddeck:nickname")).toBe("Ploy");
    expect(replace).not.toHaveBeenCalled();
  });

  it("sends a student without a KMUTT login to SSO", async () => {
    api.info.mockResolvedValue(info());
    api.join.mockRejectedValue(apiError(401, "UNAUTHORIZED"));
    renderWithIntl(<JoinFlow pin={PIN} />, "en");

    fireEvent.click(await screen.findByRole("button", { name: "Log in with your KMUTT account" }));
    await waitFor(() => expect(api.loginUrl).toHaveBeenCalledWith(PIN));
    expect(api.join).toHaveBeenCalledWith(PIN);
  });

  it("finishes the join when SSO comes back", async () => {
    api.info.mockResolvedValue(info({ requireLogin: true }));
    api.join.mockResolvedValue({ ...joined, loginType: "sso", nickname: "Ploy Student" });
    renderWithIntl(<JoinFlow pin={PIN} sso />, "en");

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/s/s1"));
    expect(api.join).toHaveBeenCalledWith(PIN);
  });

  it("offers the guest option when KMUTT sign-in failed", async () => {
    api.info.mockResolvedValue(info());
    renderWithIntl(<JoinFlow pin={PIN} sso ssoError="access_denied" />, "en");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The KMUTT sign-in was cancelled. You can join as a guest instead.",
    );
    expect(screen.getByRole("button", { name: "Try signing in again" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Join as a guest/ })).toBeVisible();
    expect(api.join).not.toHaveBeenCalled();
  });

  it("hides the guest option when the class requires a KMUTT login", async () => {
    api.info.mockResolvedValue(info({ requireLogin: true }));
    renderWithIntl(<JoinFlow pin={PIN} />, "en");

    expect(await screen.findByText(/needs a KMUTT login/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Join as a guest/ })).toBeNull();
  });

  it("takes a student who already joined straight back in", async () => {
    api.info.mockResolvedValue(info({ joined: { sessionId: "s1", nickname: "Ploy" } }));
    renderWithIntl(<JoinFlow pin={PIN} />, "en");

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/s/s1"));
  });

  it.each([
    [apiError(404, "NOT_FOUND"), "No session found"],
    [apiError(410, "SESSION_ENDED"), "Session ended"],
    [apiError(409, "SESSION_FULL"), "This class is full"],
    [apiError(429, "TOO_MANY_ATTEMPTS", { retryAfter: 42 }), "Wait 42 seconds, then try again."],
    [new ApiError(0, "NETWORK_ERROR", "offline"), "Can't reach ModDeck"],
  ])("shows a screen for %s", async (error, text) => {
    api.info.mockRejectedValue(error);
    renderWithIntl(<JoinFlow pin={PIN} />, "en");

    expect(await screen.findByText(text)).toBeVisible();
  });

  it("checks the PIN again on Try again", async () => {
    api.info.mockRejectedValueOnce(apiError(409, "SESSION_FULL")).mockResolvedValue(info());
    renderWithIntl(<JoinFlow pin={PIN} />, "en");

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("heading", { name: "INT365 Software Engineering" }),
    ).toBeVisible();
    expect(api.info).toHaveBeenCalledTimes(2);
  });
});

describe("LiveSession", () => {
  const me = (overrides: Partial<ParticipantMe> = {}): ParticipantMe => ({
    ...joined,
    title: "INT365 Software Engineering",
    status: "live",
    slideCount: 20,
    currentSlide: { id: "slide-5", index: 4 },
    currentActivity: null,
    ...overrides,
  });

  it("shows the reconnecting banner while the connection is down, and hides it after rejoin", async () => {
    api.me.mockResolvedValue(me());
    renderWithIntl(<LiveSession sessionId="s1" />, "en");
    await screen.findByText("INT365 Software Engineering");

    act(() => live.options!.onStatus!("online"));
    expect(screen.queryByText(/You can't send answers yet/)).toBeNull();

    act(() => live.options!.onStatus!("reconnecting"));
    expect(screen.getByText(/Reconnecting… You can't send answers yet/)).toBeVisible();

    act(() => live.options!.onStatus!("offline"));
    expect(screen.getByText(/No internet\. You can't send answers yet/)).toBeVisible();

    act(() => live.options!.onStatus!("online"));
    expect(screen.queryByText(/You can't send answers yet/)).toBeNull();
  });

  it("tells a student whose seat was taken that the session is full", async () => {
    api.me.mockResolvedValue(me());
    renderWithIntl(<LiveSession sessionId="s1" />, "en");
    await screen.findByText("INT365 Software Engineering");

    // LiveConnection reports the error, then ends: the status change must not hide the reason.
    act(() => {
      live.options!.onError!({ code: "SESSION_FULL", message: "full" });
      live.options!.onStatus!("ended");
    });
    expect(screen.getByText("This session is full")).toBeVisible();
  });

  it("keeps the removed message when the connection ends after it", async () => {
    api.me.mockResolvedValue(me());
    renderWithIntl(<LiveSession sessionId="s1" />, "en");
    await screen.findByText("INT365 Software Engineering");

    act(() => {
      live.options!.onError!({ code: "PARTICIPANT_REMOVED", message: "removed" });
      live.options!.onStatus!("ended");
    });
    expect(screen.getByText("You were removed from this session")).toBeVisible();
  });

  it("starts a late joiner on the current slide and follows the class", async () => {
    api.me.mockResolvedValue(me());
    renderWithIntl(<LiveSession sessionId="s1" />, "en");

    expect(await screen.findByText("Slide 5 of 20")).toBeVisible();
    expect(screen.getByText("INT365 Software Engineering")).toBeVisible();
    expect(live.connect).toHaveBeenCalled();
    expect(live.options?.sessionId).toBe("s1");

    act(() => live.options!.onStatus!("online"));
    expect(screen.getByText("Connected · Ploy")).toBeVisible();

    act(() =>
      live.options!.onEvent!({
        type: "slide_changed",
        seq: 2,
        sessionId: "s1",
        at: 0,
        data: { slideId: "slide-6", index: 5, activity: null },
      }),
    );
    expect(screen.getByText("Slide 6 of 20")).toBeVisible();

    act(() =>
      live.options!.onEvent!({
        type: "session_ended",
        seq: 3,
        sessionId: "s1",
        at: 0,
        data: { reason: "host" },
      }),
    );
    expect(screen.getByRole("heading", { name: "Session ended" })).toBeVisible();
  });

  it("asks a browser that joined another session to join this one", async () => {
    api.me.mockResolvedValue(me({ sessionId: "other" }));
    renderWithIntl(<LiveSession sessionId="s1" />, "en");

    expect(await screen.findByRole("heading", { name: "Join this session first" })).toBeVisible();
    expect(live.connect).not.toHaveBeenCalled();
  });

  it("tells a removed participant", async () => {
    api.me.mockRejectedValue(apiError(403, "PARTICIPANT_REMOVED"));
    renderWithIntl(<LiveSession sessionId="s1" />, "en");

    expect(
      await screen.findByRole("heading", { name: "You were removed from this session" }),
    ).toBeVisible();
  });
});
