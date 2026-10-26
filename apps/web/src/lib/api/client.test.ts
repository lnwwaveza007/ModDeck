/** @jest-environment node */

import { ApiError, apiFetch, NETWORK_ERROR, UNKNOWN_ERROR } from "./client";

function respond(status: number, body?: unknown) {
  return Promise.resolve(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("apiFetch", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("sends JSON with cookies and returns the parsed body", async () => {
    fetchMock.mockReturnValue(respond(201, { participantId: "par_1" }));

    const result = await apiFetch<{ participantId: string }>("/sessions/ses_1/participants", {
      method: "POST",
      body: { nickname: "ปลา" },
      baseUrl: "http://api.test/api/v1",
    });

    expect(result).toEqual({ participantId: "par_1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/api/v1/sessions/ses_1/participants");
    expect(init.credentials).toBe("include");
    expect(init.body).toBe(JSON.stringify({ nickname: "ปลา" }));
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });

  it("adds query params and skips empty ones", async () => {
    fetchMock.mockReturnValue(respond(200, []));
    await apiFetch("/sessions", { query: { status: "live", page: 2, q: undefined }, baseUrl: "" });
    expect(fetchMock.mock.calls[0][0]).toBe("/sessions?status=live&page=2");
  });

  it("returns undefined for 204", async () => {
    fetchMock.mockReturnValue(respond(204));
    await expect(apiFetch("/decks/d1", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("maps the §3.5 error body to ApiError", async () => {
    fetchMock.mockReturnValue(
      respond(409, {
        error: {
          code: "NICKNAME_TAKEN",
          message: "Nickname is already used in this session.",
          details: { field: "nickname" },
          requestId: "req_1b7e",
        },
      }),
    );

    const error = await apiFetch("/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: "NICKNAME_TAKEN",
      details: { field: "nickname" },
      requestId: "req_1b7e",
    });
  });

  it("uses UNKNOWN_ERROR when the error body has another shape", async () => {
    fetchMock.mockReturnValue(respond(502, { oops: true }));
    await expect(apiFetch("/x")).rejects.toMatchObject({ status: 502, code: UNKNOWN_ERROR });
  });

  it("uses NETWORK_ERROR when the request never reaches the server", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(apiFetch("/x")).rejects.toMatchObject({ status: 0, code: NETWORK_ERROR });
  });

  it("does not send a JSON content type for file uploads", async () => {
    fetchMock.mockReturnValue(respond(202, { importId: "imp_1" }));
    const form = new FormData();
    await apiFetch("/decks/d1/imports", { method: "POST", body: form });
    const init = fetchMock.mock.calls[0][1];
    expect(init.body).toBe(form);
    expect(new Headers(init.headers).has("Content-Type")).toBe(false);
  });
});
