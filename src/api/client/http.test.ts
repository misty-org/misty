import { beforeEach, describe, expect, it, vi } from "vitest";
import { httpRequest } from "./http";

describe("httpRequest", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("keeps public cross-origin downloads free of preflight-only headers", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("[]", { status: 200 }));

    await httpRequest(
      "https://raw.githubusercontent.com/misty-org/misty-extensions/main/catalog/index.json",
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).has("X-Request-ID")).toBe(false);
  });

  it("preserves headers explicitly supplied by the caller", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    await httpRequest("https://misty.example/api/health", {
      headers: { Accept: "application/json" },
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).get("Accept")).toBe("application/json");
  });
});
