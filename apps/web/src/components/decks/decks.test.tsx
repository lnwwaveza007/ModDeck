import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { DeckSummary } from "@moddeck/shared";
import { ToastProvider } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api/client";
import { createDeck, deleteDeck, duplicateDeck, listDecks, renameDeck } from "@/lib/api/decks";
import { renderWithIntl } from "@/test/render";
import { DeckList } from "./DeckList";

// One object for every render, like the real app router.
const mockRouter = { push: jest.fn(), replace: jest.fn() };
const { push, replace } = mockRouter;

jest.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
}));
jest.mock("@/lib/api/decks");

const api = {
  list: jest.mocked(listDecks),
  create: jest.mocked(createDeck),
  rename: jest.mocked(renameDeck),
  duplicate: jest.mocked(duplicateDeck),
  remove: jest.mocked(deleteDeck),
};

function deck(overrides: Partial<DeckSummary> = {}): DeckSummary {
  return {
    id: "d1",
    title: "INT365 W03 Template Syntax",
    slideCount: 18,
    sessionCount: 2,
    liveSessions: [],
    createdAt: "2026-10-01T03:00:00.000Z",
    updatedAt: "2026-10-20T03:00:00.000Z",
    ...overrides,
  };
}

const w03 = deck();
const w08 = deck({
  id: "d2",
  title: "INT319 W08 Bandwidth",
  slideCount: 1,
  sessionCount: 0,
  updatedAt: "2026-10-10T03:00:00.000Z",
});
const live = deck({
  id: "d3",
  title: "INT365 W04 Reactive Forms",
  slideCount: 20,
  liveSessions: [{ id: "s1", pin: "482914" }],
  updatedAt: "2026-10-25T03:00:00.000Z",
});

function renderList(locale: "th" | "en" = "en") {
  return renderWithIntl(
    <ToastProvider closeLabel="Close">
      <DeckList />
    </ToastProvider>,
    locale,
  );
}

const card = (title: string) => screen.getByRole("link", { name: title }).closest("article")!;

function openMenu(title: string) {
  fireEvent.click(screen.getByRole("button", { name: `Actions for ${title}` }));
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe("DeckList", () => {
  it("shows the empty state to a new host", async () => {
    api.list.mockResolvedValue([]);
    renderList("th");
    expect(await screen.findByRole("heading", { name: "ยังไม่มีเด็ค" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "เด็คใหม่" })).toHaveLength(2);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("shows each deck with its facts, and live decks with PIN and a way back", async () => {
    api.list.mockResolvedValue([live, w03, w08]);
    renderList();

    expect(await screen.findByRole("link", { name: w03.title })).toHaveAttribute(
      "href",
      "/decks/d1",
    );
    expect(card(w03.title)).toHaveTextContent(/18 slides · Edited .+ · 2 sessions/);
    expect(card(w08.title)).toHaveTextContent(/1 slide · Edited .+ · Never used/);

    const liveCard = card(live.title);
    expect(liveCard).toHaveTextContent("LIVE");
    expect(liveCard).toHaveTextContent("20 slides · PIN 482 914");
    expect(within(liveCard).getByRole("link", { name: /Back to session control/ })).toHaveAttribute(
      "href",
      "/host/s1",
    );

    openMenu(live.title);
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(screen.getByText("End the live session to delete")).toBeInTheDocument();
  });

  it("filters by title and says when nothing matches", async () => {
    api.list.mockResolvedValue([w03, w08]);
    renderList();
    const search = await screen.findByRole("searchbox", { name: "Search decks" });

    fireEvent.change(search, { target: { value: "bandwidth" } });
    expect(screen.getByRole("link", { name: w08.title })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: w03.title })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "routing" } });
    expect(screen.getByRole("heading", { name: "No decks match “routing”" })).toBeInTheDocument();
  });

  it("creates a deck and opens it in the editor", async () => {
    api.list.mockResolvedValue([]);
    api.create.mockResolvedValue(deck({ id: "new", title: "W05 Routing", sessionCount: 0 }));
    renderList();

    fireEvent.click((await screen.findAllByRole("button", { name: "New deck" }))[0]);
    const dialog = screen.getByRole("dialog", { name: "New deck" });
    const name = within(dialog).getByLabelText("Deck name");
    expect(name).toHaveFocus();

    fireEvent.click(within(dialog).getByRole("button", { name: "Create deck" }));
    expect(within(dialog).getByText("Enter a deck name")).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();

    fireEvent.change(name, { target: { value: "  W05 Routing " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create deck" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/decks/new"));
    expect(api.create).toHaveBeenCalledWith("W05 Routing");
  });

  it("renames a deck", async () => {
    api.list.mockResolvedValue([w03]);
    api.rename.mockResolvedValue({ ...w03, title: "W03 Templates" });
    renderList();

    await screen.findByRole("link", { name: w03.title });
    openMenu(w03.title);
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const dialog = screen.getByRole("dialog", { name: "Rename deck" });
    const name = within(dialog).getByLabelText("Deck name");
    expect(name).toHaveValue(w03.title);

    fireEvent.change(name, { target: { value: "W03 Templates" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("link", { name: "W03 Templates" })).toBeInTheDocument();
    expect(api.rename).toHaveBeenCalledWith("d1", "W03 Templates");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Deck renamed")).toBeInTheDocument();
  });

  it("duplicates a deck with a translated copy title", async () => {
    api.list.mockResolvedValue([w03]);
    api.duplicate.mockResolvedValue(
      deck({ id: "d9", title: "สำเนาของ INT365 W03 Template Syntax", sessionCount: 0 }),
    );
    renderList("th");

    fireEvent.click(await screen.findByRole("button", { name: `ตัวเลือกของ ${w03.title}` }));
    fireEvent.click(screen.getByRole("button", { name: "ทำสำเนา" }));

    expect(
      await screen.findByRole("link", { name: "สำเนาของ INT365 W03 Template Syntax" }),
    ).toBeInTheDocument();
    expect(api.duplicate).toHaveBeenCalledWith("d1", "สำเนาของ INT365 W03 Template Syntax");
    expect(screen.getByRole("link", { name: w03.title })).toBeInTheDocument();
  });

  it("deletes a deck only after the confirm", async () => {
    api.list.mockResolvedValue([w03, w08]);
    api.remove.mockResolvedValue(undefined);
    renderList();

    await screen.findByRole("link", { name: w03.title });
    openMenu(w03.title);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: `Delete “${w03.title}”?` });
    expect(dialog).toHaveTextContent("Results of its past sessions stay in Session history.");

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(api.remove).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: w03.title })).toBeInTheDocument();

    openMenu(w03.title);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete deck" }));

    await waitFor(() =>
      expect(screen.queryByRole("link", { name: w03.title })).not.toBeInTheDocument(),
    );
    expect(api.remove).toHaveBeenCalledWith("d1");
    expect(screen.getByRole("link", { name: w08.title })).toBeInTheDocument();
  });

  it("explains a refused delete and keeps the deck", async () => {
    api.list.mockResolvedValue([w03]);
    api.remove.mockRejectedValue(new ApiError(409, "DECK_LIVE", "live"));
    renderList();

    await screen.findByRole("link", { name: w03.title });
    openMenu(w03.title);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete deck" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A session on this deck is live. End it before deleting.",
    );
    expect(screen.getByRole("link", { name: w03.title })).toBeInTheDocument();
  });

  it("closes a dialog with Escape", async () => {
    api.list.mockResolvedValue([]);
    renderList();
    fireEvent.click((await screen.findAllByRole("button", { name: "New deck" }))[0]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("sends a logged-out host to the login page", async () => {
    api.list.mockRejectedValue(new ApiError(401, "UNKNOWN_ERROR", "HTTP 401"));
    renderList();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });

  it("shows an error with retry when the list does not load", async () => {
    api.list.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "offline"));
    api.list.mockResolvedValueOnce([w03]);
    renderList();

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: w03.title })).toBeInTheDocument();
  });
});
