import { basePathOf } from "./auth.config";
import { txCookieOptions } from "./cookies";

describe("basePathOf", () => {
  it("returns the path of APP_BASE_URL without a trailing slash", () => {
    expect(basePathOf("https://bscit.sit.kmutt.ac.th/capstone26/cp26ssa2")).toBe(
      "/capstone26/cp26ssa2",
    );
    expect(basePathOf("https://bscit.sit.kmutt.ac.th/capstone26/cp26ssa2/")).toBe(
      "/capstone26/cp26ssa2",
    );
  });

  it("is empty for a bare origin, an unset value or garbage", () => {
    expect(basePathOf("http://localhost:3000")).toBe("");
    expect(basePathOf("https://example.com/")).toBe("");
    expect(basePathOf(undefined)).toBe("");
    expect(basePathOf("not a url")).toBe("");
  });
});

describe("txCookieOptions", () => {
  it("scopes the handshake cookie to the callback path the browser sees", () => {
    const cfg = { cookieSecure: true, cookieBasePath: "/capstone26/cp26ssa2" };
    expect(txCookieOptions(cfg).path).toBe("/capstone26/cp26ssa2/api/auth");
  });

  it("keeps /api/auth at the site root", () => {
    expect(txCookieOptions({ cookieSecure: true }).path).toBe("/api/auth");
    expect(txCookieOptions({ cookieSecure: true, cookieBasePath: "" }).path).toBe("/api/auth");
  });
});
