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

  it("retries idempotent GET requests on transient 'Load failed' error and succeeds", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("Load failed"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await httpRequest("https://misty.example/api/apps");
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry POST requests on network error", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("Load failed"));

    await expect(
      httpRequest("https://misty.example/api/apps", { method: "POST" }),
    ).rejects.toThrow("Could not reach https://misty.example/api/apps: Load failed");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propagates AbortError immediately when signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      httpRequest("https://misty.example/api/apps", { signal: controller.signal }),
    ).rejects.toThrow("Request was aborted");
  });
});
