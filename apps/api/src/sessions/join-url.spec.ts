import { joinUrl } from "./join-url";

describe("joinUrl", () => {
  const saved = { app: process.env.APP_BASE_URL, web: process.env.WEB_ORIGIN };
  afterEach(() => {
    if (saved.app === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = saved.app;
    if (saved.web === undefined) delete process.env.WEB_ORIGIN;
    else process.env.WEB_ORIGIN = saved.web;
  });

  it("keeps the URL prefix from APP_BASE_URL", () => {
    process.env.APP_BASE_URL = "https://bscit.sit.kmutt.ac.th/capstone26/cp26ssa2/";
    process.env.WEB_ORIGIN = "https://bscit.sit.kmutt.ac.th";
    expect(joinUrl("123456")).toBe("https://bscit.sit.kmutt.ac.th/capstone26/cp26ssa2/j/123456");
  });

  it("falls back to WEB_ORIGIN, then localhost", () => {
    delete process.env.APP_BASE_URL;
    process.env.WEB_ORIGIN = "https://moddeck.example";
    expect(joinUrl("123456")).toBe("https://moddeck.example/j/123456");
    delete process.env.WEB_ORIGIN;
    expect(joinUrl("123456")).toBe("http://localhost:3000/j/123456");
  });
});
