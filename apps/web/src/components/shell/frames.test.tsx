import { fireEvent, screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { HostNav } from "./HostNav";
import { LiveShell } from "./LiveShell";
import { SessionHeader } from "./SessionHeader";

const push = jest.fn();
let pathname = "/decks";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => pathname,
}));
jest.mock("@/lib/i18n/actions", () => ({ setLocale: jest.fn() }));

describe("HostNav", () => {
  it("marks the current section", () => {
    pathname = "/sessions/ses_1";
    renderWithIntl(<HostNav />, "en");
    expect(screen.getByRole("link", { name: "Session history" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "My decks" })).not.toHaveAttribute("aria-current");
  });
});

describe("LiveShell", () => {
  it("switches between the Activity and Q&A tabs", () => {
    renderWithIntl(<LiveShell title="INT365" activity={<p>poll</p>} qa={<p>questions</p>} />, "en");
    expect(screen.getByText("poll")).toBeInTheDocument();
    expect(screen.getByText("Connecting…")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Q&A" }));
    expect(screen.getByText("questions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Q&A" })).toHaveAttribute("aria-current", "page");
  });

  it("keeps the language switch in the menu (MD-5 §2.7)", () => {
    renderWithIntl(<LiveShell title="INT365" activity={null} qa={null} />, "th");
    expect(screen.queryByRole("button", { name: "Switch to English" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "เมนู" }));
    expect(screen.getByRole("button", { name: "Switch to English" })).toBeInTheDocument();
  });
});

describe("SessionHeader", () => {
  it("shows the LIVE badge for the presenter", () => {
    renderWithIntl(<SessionHeader leading="live" title="INT365" />, "en");
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "INT365" })).toBeInTheDocument();
  });

  it("links back to My decks from the editor", () => {
    renderWithIntl(<SessionHeader leading="back" title="Deck" />, "en");
    expect(screen.getByRole("link", { name: "Back to My decks" })).toHaveAttribute(
      "href",
      "/decks",
    );
  });
});
