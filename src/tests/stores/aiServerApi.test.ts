import { beforeEach, describe, expect, it, vi } from "vitest";

const accountSession = vi.hoisted(() => ({ transitioning: false, generation: 0 }));

vi.mock("@/stores/account/useAuthTokenStore", () => ({
  isAccountSessionTransitioning: () => accountSession.transitioning,
  readAccountSessionGeneration: () => accountSession.generation,
  readAccountAuthToken: vi.fn().mockResolvedValue("signed-in-token"),
}));

vi.mock("@/stores/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/stores/backend")>()),
  appSnapshot: vi.fn().mockRejectedValue(new Error("not running in Tauri")),
}));

import {
  createAgentSession,
  fetchAgentStatus,
  listAgentSessions,
  renameAgentSession,
} from "@/stores/agent/useAiServerStore";

describe("Agent server API", () => {
  beforeEach(() => {
    accountSession.transitioning = false;
    accountSession.generation = 0;
    vi.stubEnv("VITE_MISTY_SERVER_URL", "https://misty.example");
  });

  it("propagates the bearer token and accepts an explicit model status contract", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          configured: true,
          provider: "misty",
          model: "google/gemini-2.5-flash-lite",
          model_name: "Gemini 2.5 Flash-Lite",
          running: false,
          session_id: null,
          error: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(fetchAgentStatus()).resolves.toMatchObject({
      model: "google/gemini-2.5-flash-lite",
      model_name: "Gemini 2.5 Flash-Lite",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://misty.example/api/ai/status",
      expect.objectContaining({
        credentials: "include",
        headers: expect.any(Headers),
      }),
    );
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer signed-in-token");
  });

  it("preserves structured hosted-AI-limit handling", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "hosted_ai_limit_reached",
          reset_at: "2026-08-01T00:00:00Z",
        }),
        { status: 402, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(createAgentSession()).rejects.toThrow("Weekly hosted AI usage is fully used");
  });

  it("binds a new agent session to the requested Space", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ session_id: "space-session" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await createAgentSession(undefined, "space-a");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://misty.example/api/ai/sessions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ space_id: "space-a" }),
      }),
    );
  });

  it("blocks managed agent requests while an account switch is in progress", async () => {
    accountSession.transitioning = true;
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(fetchAgentStatus()).rejects.toMatchObject({
      message: "Wait for the account switch to finish.",
      status: 409,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an agent response that arrives after the account generation changes", async () => {
    let releaseResponse!: (response: Response) => void;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => new Promise<Response>((resolve) => (releaseResponse = resolve)));
    const request = fetchAgentStatus();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    accountSession.generation += 1;
    releaseResponse(
      new Response(JSON.stringify({ configured: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(request).rejects.toMatchObject({ code: "account_changed", status: 409 });
  });

  it("rejects an agent body that finishes decoding after the account generation changes", async () => {
    let releaseBody!: (value: unknown) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "Content-Type": "application/json" }),
      json: () => new Promise((resolve) => (releaseBody = resolve)),
    } as Response);
    const request = fetchAgentStatus();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    accountSession.generation += 1;
    releaseBody({ configured: true });

    await expect(request).rejects.toMatchObject({ code: "account_changed", status: 409 });
  });

  it("does not misclassify a gateway 429 as exhausted hosted AI", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response("The agent could not complete this request.", { status: 429 }),
      );

    await expect(createAgentSession()).rejects.not.toThrow("hosted AI usage is fully used");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports rate limits without retrying the request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "rate_limited",
          retry_after_seconds: 30,
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(createAgentSession()).rejects.toThrow(
      "Try again in 30 seconds. Requests are never retried automatically.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lists the account's sessions so another device can rebuild them", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          sessions: [
            {
              id: "conversation_1",
              title: "Rename batch",
              active: false,
              created_at: "2026-07-20T10:00:00Z",
              updated_at: "2026-07-20T11:00:00Z",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(listAgentSessions()).resolves.toMatchObject({
      sessions: [{ id: "conversation_1", title: "Rename batch", active: false }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://misty.example/api/ai/sessions",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("patches a session title so the label follows the account", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    await renameAgentSession("conversation_1", "Find duplicates");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://misty.example/api/ai/sessions/conversation_1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "Find duplicates" }),
      }),
    );
  });
});
