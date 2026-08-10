import { beforeEach, describe, expect, it, vi } from "vitest";

const saveAccountAuthToken = vi.fn(async () => undefined);

vi.mock("../store/useAuthTokenStore", () => ({
  saveAccountAuthToken,
}));

describe("demo session bootstrap", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => {
          values.delete(key);
        },
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
      },
    });
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("does nothing outside a demo launch", async () => {
    const { bootstrapDemoSession } = await import("../demoSessionBootstrap");
    await bootstrapDemoSession();
    expect(saveAccountAuthToken).not.toHaveBeenCalled();
  });

  it("activates the reserved demo account before application startup", async () => {
    vi.stubEnv("VITE_MISTY_DEMO_MODE", "1");
    vi.stubEnv("VITE_MISTY_DEMO_SESSION_TOKEN", "session-token-that-is-at-least-32-characters");
    vi.stubEnv(
      "VITE_MISTY_DEMO_ACCOUNT",
      JSON.stringify({
        id: "owner-id",
        name: "Maya Chen",
        username: "maya_research",
        email: "maya@demo.misty.local",
      }),
    );
    const { bootstrapDemoSession } = await import("../demoSessionBootstrap");

    await bootstrapDemoSession();

    expect(saveAccountAuthToken).toHaveBeenCalledWith(
      "session-token-that-is-at-least-32-characters",
      expect.objectContaining({ id: "owner-id", email: "maya@demo.misty.local" }),
    );
    expect(JSON.parse(localStorage.getItem("misty_user") ?? "{}")).toMatchObject({
      id: "owner-id",
    });
  });

  it("rejects non-demo identities", async () => {
    const { parseDemoAccount } = await import("../demoSessionBootstrap");
    expect(() =>
      parseDemoAccount(
        JSON.stringify({
          id: "owner-id",
          name: "Maya Chen",
          email: "maya@example.com",
        }),
      ),
    ).toThrow(/reserved demo email/i);
  });
});
