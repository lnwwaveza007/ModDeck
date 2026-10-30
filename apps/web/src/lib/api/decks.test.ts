/** @jest-environment node */

import { createDeck, deleteDeck, duplicateDeck, listDecks, renameDeck } from "./decks";

describe("deck api calls", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(() => Promise.resolve(new Response("{}", { status: 200 })));
    global.fetch = fetchMock;
  });

  const call = (i = 0) => {
    const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
    return { url, method: init.method ?? "GET", body: init.body, credentials: init.credentials };
  };

  it("go through the same-origin /api path with the host cookie", async () => {
    await listDecks();
    expect(call()).toMatchObject({ url: "/api/decks", method: "GET", credentials: "include" });
  });

  it("use the §3.3 methods and paths", async () => {
    await createDeck("W05");
    await renameDeck("d1", "W05 Routing");
    await duplicateDeck("d1", "Copy of W05");
    await deleteDeck("d1");

    expect([0, 1, 2, 3].map((i) => call(i))).toMatchObject([
      { url: "/api/decks", method: "POST", body: JSON.stringify({ title: "W05" }) },
      { url: "/api/decks/d1", method: "PATCH", body: JSON.stringify({ title: "W05 Routing" }) },
      {
        url: "/api/decks/d1/copies",
        method: "POST",
        body: JSON.stringify({ title: "Copy of W05" }),
      },
      { url: "/api/decks/d1", method: "DELETE" },
    ]);
  });
});
