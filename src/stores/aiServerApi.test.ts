import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../pages/Account/shared/authTokenStore", () => ({
  readAccountAuthToken: vi.fn().mockResolvedValue("signed-in-token"),
}));

vi.mock("../api/misty", () => ({
  appSnapshot: vi.fn().mockRejectedValue(new Error("not running in Tauri")),
}));

import { createAgentSession, fetchAgentStatus } from "./aiServerApi";

describe("Mika server API", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_MISTY_SERVER_URL", "https://misty.example");
  });

  it("propagates the bearer token and accepts the public Mika status contract", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      configured: true,
      provider: "misty",
      model: "mika-high",
      model_name: "Mika High",
      running: false,
      session_id: null,
      error: null,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(fetchAgentStatus()).resolves.toMatchObject({ model: "mika-high", model_name: "Mika High" });
    expect(fetchMock).toHaveBeenCalledWith("https://misty.example/api/ai/status", expect.objectContaining({
      credentials: "include",
      headers: expect.any(Headers),
    }));
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer signed-in-token");
  });

  it("preserves structured credits-exhausted handling", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      code: "credits_exhausted",
      available_credits: 0,
      reset_at: "2026-08-01T00:00:00Z",
    }), { status: 402, headers: { "Content-Type": "application/json" } }));

    await expect(createAgentSession()).rejects.toThrow("Misty credits exhausted (0 available)");
  });

  it("does not misclassify a gateway 429 as exhausted credits", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Mika could not complete this request.", { status: 429 }));

    await expect(createAgentSession()).rejects.not.toThrow("credits exhausted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports rate limits without retrying the request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      code: "rate_limited",
      retry_after_seconds: 30,
    }), { status: 429, headers: { "Content-Type": "application/json" } }));

    await expect(createAgentSession()).rejects.toThrow("Try again in 30 seconds. Requests are never retried automatically.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
