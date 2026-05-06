import { setSpaceReferenceOnly } from "@/api/spaces/connectivity";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ transitioning: false, generation: 0 }));

vi.mock("@/api/deployment/api", () => ({
  resolveApiBase: vi.fn(async () => "https://misty.example/api"),
}));

import { apiRequest } from "./request";
import { configureApiSession } from "./session";

beforeEach(() => {
  vi.restoreAllMocks();
  session.transitioning = false;
  session.generation = 0;
  configureApiSession({
    isTransitioning: () => session.transitioning,
    readGeneration: () => session.generation,
    readToken: async () => "account-token",
  });
  setSpaceReferenceOnly(false);
});

describe("apiRequest", () => {
  it("authenticates account-wide requests without applying Space reference mode", async () => {
    setSpaceReferenceOnly(true);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "agent-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      apiRequest<{ id: string }>("/agents", {
        method: "POST",
        body: JSON.stringify({ name: "Mika" }),
      }),
    ).resolves.toEqual({ id: "agent-1" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://misty.example/api/agents");
    expect(init?.credentials).toBe("include");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer account-token");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    expect(new Headers(init?.headers).get("X-Request-ID")).toMatch(/^desktop_/);
  });

  it("rejects a response that finishes after the active account changes", async () => {
    let release!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>((resolve) => (release = resolve)),
    );
    const pending = apiRequest("/agents");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));

    session.generation += 1;
    release(new Response(JSON.stringify({ agents: [] }), { status: 200 }));

    await expect(pending).rejects.toMatchObject({
      name: "ApiRequestError",
      code: "account_changed",
      status: 409,
    });
  });

  it("returns a neutral coded error for non-Space domains", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "forbidden" }), { status: 403 }),
    );

    await expect(apiRequest("/cloud/connections")).rejects.toEqual(
      expect.objectContaining({
        name: "ApiRequestError",
        message: "You do not have permission to perform that action.",
        code: "forbidden",
        status: 403,
      }),
    );
  });
});
