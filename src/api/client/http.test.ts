import { beforeEach, describe, expect, it, vi } from "vitest";
import { httpRequest, resetHttpOutageForTests } from "./http";

describe("httpRequest", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetHttpOutageForTests();
  });

  it("makes one attempt per request after retries are exhausted, until one succeeds", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("down", { status: 503 }));

    expect((await httpRequest("https://misty.example/api/apps")).status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockClear();
    expect((await httpRequest("https://misty.example/api/spaces")).status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    resetHttpOutageForTests();
    expect((await httpRequest("https://misty.example/api/apps")).status).toBe(200);
    fetchMock.mockResolvedValue(new Response("down", { status: 503 }));
    await httpRequest("https://misty.example/api/apps");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not retry a 503 that asks for a longer pause", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("busy", { status: 503, headers: { "Retry-After": "30" } }));

    expect((await httpRequest("https://misty.example/api/apps")).status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

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

    await expect(httpRequest("https://misty.example/api/apps", { method: "POST" })).rejects.toThrow(
      "Could not reach https://misty.example/api/apps: Load failed",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up on a GET the server never answers after 30 seconds, without retrying", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const aborted = new Error("aborted");
              aborted.name = "AbortError";
              reject(aborted);
            });
          }),
      );

      const request = httpRequest("https://misty.example/api/spaces");
      const outcome = expect(request).rejects.toThrow("The server took too long to answer.");
      await vi.advanceTimersByTimeAsync(30_000);
      await outcome;
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a GET that answers in time", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));
      const response = await httpRequest("https://misty.example/api/spaces");
      await vi.advanceTimersByTimeAsync(31_000);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });

  it("propagates AbortError immediately when signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      httpRequest("https://misty.example/api/apps", { signal: controller.signal }),
    ).rejects.toThrow("Request was aborted");
  });

  it("turns a caller's timeout into an AbortError instead of failing to rename it", async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const fail = () => reject(new DOMException("The operation timed out.", "TimeoutError"));
          if (init?.signal?.aborted) fail();
          else init?.signal?.addEventListener("abort", fail);
        }),
    );

    const request = httpRequest("https://misty.example/api/spaces", { signal: controller.signal });
    controller.abort(new DOMException("The operation timed out.", "TimeoutError"));
    const error = await request.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe("AbortError");
  });

  it("still lets the caller abort a response body after the answer arrives", async () => {
    const controller = new AbortController();
    let seen: AbortSignal | null | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      seen = init?.signal;
      return new Response("ok", { status: 200 });
    });

    await httpRequest("https://misty.example/api/me/events", { signal: controller.signal });
    expect(seen?.aborted).toBe(false);
    controller.abort();
    expect(seen?.aborted).toBe(true);
  });
});
