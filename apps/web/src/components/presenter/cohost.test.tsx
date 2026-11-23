import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { LiveSessionView, SessionControlView } from "@moddeck/shared";
import {
  getSessionControl,
  inviteCohost,
  removeCohost,
  takeSessionControl,
} from "@/lib/api/cohost";
import { ApiError } from "@/lib/api/client";
import { getLiveSession, moveToSlide, setQuestionStatus } from "@/lib/api/live";
import { listParticipants } from "@/lib/api/participants";
import { getSession } from "@/lib/api/sessions";
import type { LiveConnectionOptions } from "@/lib/realtime/live-connection";
import { renderWithIntl } from "@/test/render";
import { ToastProvider } from "@/components/ui/Toast";
import { PresenterControl } from "./PresenterControl";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));
jest.mock("@/lib/api/cohost");
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

const view: LiveSessionView = {
  id: "s1",
  deckId: "d1",
  pin: "482914",
  status: "live",
  title: "INT365 Reactive Forms",
  joinUrl: "http://localhost:3000/j/482914",
  startedAt: new Date().toISOString(),
  serverNow: Date.now(),
  currentSlideId: "slide-0",
  slides: [
    { id: "slide-0", position: 0, kind: "content", elements: [], activity: null },
    { id: "slide-1", position: 1, kind: "content", elements: [], activity: null },
  ],
  runs: [],
  tallies: {},
  clouds: {},
  hiddenWords: {},
  showResultsLive: false,
  reactionsEnabled: true,
  qaOpen: true,
  questions: [
    {
      id: "q1",
      text: "When is the exam?",
      anonymous: true,
      status: "visible",
      votes: 3,
      createdAt: "2026-11-21T09:00:00.000Z",
    },
  ],
  participantCount: 1,
};

const owner = { userId: "u-owner", displayName: "Aj. Somsak" };
const ta = { userId: "u-ta", displayName: "TA Ploy", email: "ploy@kmutt.ac.th" };

const control = (overrides: Partial<SessionControlView> = {}): SessionControlView => ({
  owner,
  cohost: ta,
  invite: null,
  controllerId: owner.userId,
  viewerId: ta.userId,
  role: "cohost",
  ...overrides,
});

function open(mode?: "moderation") {
  renderWithIntl(
    <ToastProvider closeLabel="Close">
      <PresenterControl sessionId="s1" mode={mode} />
    </ToastProvider>,
    "en",
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  live.options = undefined;
  jest.mocked(getLiveSession).mockResolvedValue(view);
  jest.mocked(getSession).mockResolvedValue({
    id: "s1",
    pin: "482914",
    status: "live",
    participantCount: 1,
    deck: { title: view.title },
    joinUrl: view.joinUrl,
    serverNow: Date.now(),
  });
  jest.mocked(listParticipants).mockResolvedValue([]);
});

describe("Co-host page", () => {
  it("moderates Q&A, with no slide controls and Q&A open/close locked", async () => {
    jest.mocked(getSessionControl).mockResolvedValue(control());
    open("moderation");

    expect(await screen.findByText("Aj. Somsak runs presenter control.")).toBeVisible();
    expect(screen.getByText("Co-host · Q&A moderation")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Next/ })).toBeNull();
    expect(screen.getByRole("switch", { name: /Open for questions/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Hide from students: When is the exam?" }));
    await waitFor(() => expect(setQuestionStatus).toHaveBeenCalledWith("s1", "q1", "hide"));

    // Arrow keys move no slide from here.
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(moveToSlide).not.toHaveBeenCalled();
  });

  it("takes over after a confirm, then offers presenter control", async () => {
    jest.mocked(getSessionControl).mockResolvedValue(control());
    jest.mocked(takeSessionControl).mockResolvedValue(control({ controllerId: ta.userId }));
    open("moderation");

    fireEvent.click(await screen.findByRole("button", { name: "Take over" }));
    const dialog = screen.getByRole("dialog", { name: "Take over presenter control?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Take over" }));

    await waitFor(() => expect(takeSessionControl).toHaveBeenCalledWith("s1"));
    expect(await screen.findByText("You run presenter control.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open presenter control" })).toHaveAttribute(
      "href",
      "/host/s1",
    );
  });

  it("gives the co-host in control the presenter, without wording edits", async () => {
    jest.mocked(getSessionControl).mockResolvedValue(control({ controllerId: ta.userId }));
    open();

    expect(
      await screen.findByText(/You took over presenter control from Aj. Somsak/),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Invite co-host" })).toBeNull();
    const strip = screen.getByRole("navigation", { name: "Slides" });
    fireEvent.click(within(strip).getByRole("button", { name: "Go to slide 2" }));
    await waitFor(() => expect(moveToSlide).toHaveBeenCalledWith("s1", "slide-1"));
    expect(screen.queryByRole("button", { name: "Edit wording" })).toBeNull();
  });
});

describe("Owner", () => {
  const asOwner = (overrides: Partial<SessionControlView> = {}) =>
    control({ viewerId: owner.userId, role: "owner", cohost: null, ...overrides });

  it("invites a co-host by KMUTT email and shows the link once", async () => {
    jest.mocked(getSessionControl).mockResolvedValue(asOwner());
    const invite = { id: "i1", email: "ploy@kmutt.ac.th", expiresAt: "2026-11-21T17:00:00.000Z" };
    jest
      .mocked(inviteCohost)
      .mockResolvedValue({ invite, url: "http://localhost:3000/cohost/abc" });
    open();

    fireEvent.click(await screen.findByRole("button", { name: "Invite co-host" }));
    const dialog = screen.getByRole("dialog", { name: "Co-host" });
    const email = within(dialog).getByLabelText("KMUTT email");
    fireEvent.change(email, { target: { value: "ploy@gmail.com" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Invite by email" }));
    expect(within(dialog).getByText(/Enter a KMUTT email/)).toBeVisible();
    expect(inviteCohost).not.toHaveBeenCalled();

    fireEvent.change(email, { target: { value: "ploy@kmutt.ac.th" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Invite by email" }));
    await waitFor(() => expect(inviteCohost).toHaveBeenCalledWith("s1", "ploy@kmutt.ac.th"));
    expect(
      await within(dialog).findByText("Waiting for ploy@kmutt.ac.th to accept."),
    ).toBeVisible();
    expect(within(dialog).getByRole("textbox", { name: "Invite link" })).toHaveValue(
      "http://localhost:3000/cohost/abc",
    );
  });

  it("says when the session already has a co-host", async () => {
    jest.mocked(getSessionControl).mockResolvedValue(asOwner());
    jest
      .mocked(inviteCohost)
      .mockRejectedValue(new ApiError(409, "COHOST_EXISTS", "This session already has a co-host"));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Invite co-host" }));
    fireEvent.click(screen.getByRole("button", { name: "Create invite link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This session already has a co-host.",
    );
  });

  it("is told of a take-over, gets the moderation view, and removes the co-host", async () => {
    jest.mocked(getSessionControl).mockResolvedValue(asOwner({ cohost: ta }));
    jest.mocked(removeCohost).mockResolvedValue(undefined);
    open();
    await screen.findByRole("button", { name: "Co-host · TA Ploy" });

    act(() =>
      live.options!.onControl!({
        ...asOwner({ cohost: ta, controllerId: ta.userId }),
        change: "takeover",
      }),
    );
    expect(
      await screen.findByText("TA Ploy took over presenter control. You can take it back."),
    ).toBeVisible();
    expect(screen.getByText("TA Ploy runs presenter control.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Take back" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Next/ })).toBeNull();
  });
});
