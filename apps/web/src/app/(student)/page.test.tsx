import { screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import type { Locale } from "@/lib/i18n/config";
import { messages, renderWithIntl } from "@/test/render";
import Home from "./page";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));
jest.mock("@/lib/i18n/actions", () => ({ setLocale: jest.fn() }));
jest.mock("@/lib/api/participants");

// The page is a server component: getTranslations reads the same message files as the client.
let mockLocale: Locale = "th";
jest.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({
      locale: mockLocale,
      messages: messages[mockLocale],
      namespace: namespace as "landing",
    }),
}));

async function renderHome(locale: Locale, query: Record<string, string> = {}) {
  mockLocale = locale;
  return renderWithIntl(await Home({ searchParams: Promise.resolve(query) }), locale);
}

describe("Home page", () => {
  it("shows the MD-15 PIN entry in Thai", async () => {
    await renderHome("th");
    expect(screen.getByRole("heading", { name: "เข้าร่วมห้องเรียน" })).toBeInTheDocument();
    expect(screen.getByLabelText("PIN")).toBeInTheDocument();
    expect(screen.getByText("ModDeck")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("links hosts to the login page in the chosen language", async () => {
    await renderHome("en");
    expect(screen.getByRole("heading", { name: "Join a class" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log in with your KMUTT account" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("asks for the PIN again when the join page sent the student back", async () => {
    await renderHome("en", { pin: "invalid" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No class uses this PIN. Check the PIN on the screen and enter it again.",
    );
  });
});
