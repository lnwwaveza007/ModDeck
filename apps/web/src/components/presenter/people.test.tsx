import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { LiveSessionView, ParticipantRow } from "@moddeck/shared";
import { ApiError } from "@/lib/api/client";
import { getLiveSession } from "@/lib/api/live";
import { listParticipants, removeParticipant, renameParticipant } from "@/lib/api/participants";
import { getSession } from "@/lib/api/sessions";
import type { LiveConnectionOptions } from "@/lib/realtime/live-connection";
import { renderWithIntl } from "@/test/render";
import { ToastProvider } from "@/components/ui/Toast";
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

const api = {
  list: jest.mocked(listParticipants),
  rename: jest.mocked(renameParticipant),
  remove: jest.mocked(removeParticipant),
};

const row = (overrides: Partial<ParticipantRow>): ParticipantRow => ({
  id: "p1",
  nickname: "Ploy",
  loginType: "guest",
  online: true,
  joinedAt: "2026-11-21T09:00:00.000Z",
  ...overrides,
});

const ploy = row({});
const somchai = row({
  id: "p2",
  nickname: "Somchai K",
  loginType: "sso",
  online: false,
  joinedAt: "2026-11-21T09:01:00.000Z",
});

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
  slides: [{ id: "slide-0", position: 0, kind: "content", elements: [], activity: null }],
  runs: [],
  tallies: {},
  clouds: {},
  hiddenWords: {},
  showResultsLive: false,
  reactionsEnabled: true,
  participantCount: 2,
};

async function openPeople() {
  renderWithIntl(
    <ToastProvider closeLabel="Close">
      <PresenterControl sessionId="s1" />
    </ToastProvider>,
    "en",
  );
  fireEvent.click(await screen.findByRole("button", { name: "People · 1 online / 2" }));
  return screen.getByRole("dialog", { name: "People" });
}

const rowOf = (drawer: HTMLElement, name: string) =>
  within(drawer).getByText(name).closest("li") as HTMLElement;

beforeEach(() => {
  jest.clearAllMocks();
  live.options = undefined;
  jest.mocked(getLiveSession).mockResolvedValue(view);
  jest.mocked(getSession).mockResolvedValue({
    id: "s1",
    pin: "482914",
    status: "live",
    participantCount: 2,
    deck: { title: "INT365 Reactive Forms" },
    joinUrl: "http://localhost:3000/j/482914",
    serverNow: Date.now(),
  });
  api.list.mockResolvedValue([ploy, somchai]);
});

describe("People drawer", () => {
  it("lists who joined, guest or KMUTT, online first", async () => {
    const drawer = await openPeople();
    expect(within(drawer).getByText("1 online · 2 joined")).toBeVisible();
    const items = within(drawer).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Ploy");
    expect(items[0]).toHaveTextContent("Online");
    expect(items[0]).toHaveTextContent("Guest");
    expect(items[1]).toHaveTextContent("Somchai K");
    expect(items[1]).toHaveTextContent("Offline");
    expect(items[1]).toHaveTextContent("KMUTT");
    // A KMUTT student shows their KMUTT name: no Rename.
    expect(within(items[1]).queryByRole("button", { name: /Rename/ })).toBeNull();
    expect(within(items[1]).getByRole("button", { name: "Remove Somchai K" })).toBeVisible();
  });

  it("follows the room: online state, new people and removals", async () => {
    const drawer = await openPeople();
    act(() => live.options!.onPeople!({ type: "update", row: { ...somchai, online: true } }));
    expect(within(drawer).getByText("2 online · 2 joined")).toBeVisible();
    act(() =>
      live.options!.onPeople!({
        type: "update",
        row: row({ id: "p3", nickname: "Mint", joinedAt: "2026-11-21T09:02:00.000Z" }),
      }),
    );
    expect(within(drawer).getByText("Mint")).toBeVisible();
    act(() => live.options!.onPeople!({ type: "removed", participantId: "p1" }));
    expect(within(drawer).queryByText("Ploy")).toBeNull();
    expect(screen.getByRole("button", { name: "People · 2 online / 2" })).toBeInTheDocument();
  });

  it("finds a participant by name", async () => {
    const drawer = await openPeople();
    fireEvent.change(within(drawer).getByRole("searchbox"), { target: { value: "somch" } });
    expect(within(drawer).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.change(within(drawer).getByRole("searchbox"), { target: { value: "zzz" } });
    expect(within(drawer).getByText("No one is called “zzz”.")).toBeVisible();
  });

  it("renames a guest to the name the host types", async () => {
    api.rename.mockResolvedValue({ ...ploy, nickname: "Guest Seven" });
    const drawer = await openPeople();
    fireEvent.click(within(rowOf(drawer, "Ploy")).getByRole("button", { name: "Rename Ploy" }));
    const input = within(drawer).getByLabelText("New name for Ploy");
    fireEvent.change(input, { target: { value: "  Guest   Seven " } });
    fireEvent.click(within(drawer).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(within(drawer).getByText("Guest Seven")).toBeVisible());
    expect(api.rename).toHaveBeenCalledWith("s1", "p1", "Guest Seven");
  });

  it("says why a name was refused and keeps the form open", async () => {
    api.rename.mockRejectedValue(new ApiError(409, "NICKNAME_TAKEN", "taken"));
    const drawer = await openPeople();
    fireEvent.click(within(rowOf(drawer, "Ploy")).getByRole("button", { name: "Rename Ploy" }));
    const input = within(drawer).getByLabelText("New name for Ploy");

    // The join rules are checked before anything is sent.
    fireEvent.change(input, { target: { value: "x" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "Save" }));
    expect(within(drawer).getByRole("alert")).toHaveTextContent("Use at least 2 characters.");
    expect(api.rename).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "Fern" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "Save" }));
    expect(await within(drawer).findByRole("alert")).toHaveTextContent(
      "Someone in this class already uses this name.",
    );
    expect(within(drawer).getByLabelText("New name for Ploy")).toBeVisible();
  });

  it("removes a participant after a confirm", async () => {
    api.remove.mockResolvedValue(undefined);
    const drawer = await openPeople();
    fireEvent.click(within(rowOf(drawer, "Ploy")).getByRole("button", { name: "Remove Ploy" }));
    const confirm = screen.getByRole("dialog", { name: "Remove Ploy?" });
    expect(confirm).toHaveTextContent("The export keeps them, marked Removed.");
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(within(drawer).queryByText("Ploy")).toBeNull());
    expect(api.remove).toHaveBeenCalledWith("s1", "p1");
    expect(screen.queryByRole("dialog", { name: "Remove Ploy?" })).toBeNull();
  });

  it("loads the list again each time the host socket is online", async () => {
    await openPeople();
    expect(api.list).toHaveBeenCalledTimes(1);
    // Online for the first time: changes from before the socket joined the host room count.
    act(() => live.options!.onStatus!("online"));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    act(() => live.options!.onStatus!("reconnecting"));
    act(() => live.options!.onStatus!("online"));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(3));
  });

  it("keeps an event that comes while the list is loading", async () => {
    const drawer = await openPeople();
    let answer!: (rows: ParticipantRow[]) => void;
    api.list.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    act(() => live.options!.onStatus!("online"));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));

    // Somchai comes online after the server read the list, before its answer arrives.
    act(() => live.options!.onPeople!({ type: "update", row: { ...somchai, online: true } }));
    await act(async () => answer([ploy, somchai]));
    expect(within(drawer).getByText("2 online · 2 joined")).toBeVisible();
  });
});
