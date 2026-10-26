import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import Home from "./page";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/lib/i18n/actions", () => ({ setLocale: jest.fn() }));

describe("Home page", () => {
  it("shows the MD-15 PIN entry in Thai", () => {
    renderWithIntl(<Home />);
    expect(screen.getByRole("heading", { name: "เข้าร่วมห้องเรียน" })).toBeInTheDocument();
    expect(screen.getByLabelText("PIN")).toBeInTheDocument();
    expect(screen.getByText("ModDeck")).toBeInTheDocument();
  });

  it("links hosts to the login page in the chosen language", () => {
    renderWithIntl(<Home />, "en");
    expect(screen.getByRole("heading", { name: "Join a class" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log in with your KMUTT account" })).toHaveAttribute(
      "href",
      "/login",
    );
  });
});
