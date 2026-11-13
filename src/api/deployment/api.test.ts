import { beforeEach, describe, expect, it, vi } from "vitest";

const saved = vi.hoisted(() => ({ state: null as unknown, revision: 0 }));
vi.mock("@/native/invoke", () => ({
  invoke: vi.fn(async (command: string, args: { revision?: number; document?: unknown }) => {
    if (command === "settings_session_state")
      return { revision: saved.revision, state: saved.state };
    if (command === "settings_session_commit") {
      if (args.revision !== saved.revision) throw new Error("SETTINGS_REVISION_CONFLICT");
      saved.state = args.document;
      saved.revision += 1;
      return { revision: saved.revision, state: saved.state };
    }
    throw new Error(`unexpected ${command}`);
  }),
}));

const deployment = await import("@/api/deployment/api");
const choice = await import("@/api/deployment/serverChoice");

describe("hosted deployment routing", () => {
  beforeEach(() => localStorage.clear());

  it("uses the loopback Go API for desktop development until a server is chosen", async () => {
    expect(await deployment.resolveApiBase()).toBe("http://127.0.0.1:8081/v1");
    expect(choice.useServerChoice.getState()).toMatchObject({ loaded: true, choice: null });
  });

  it("uses the server this device chose, and none when browsing only", async () => {
    await choice.saveServerChoice({ mode: "server", url: "https://misty.example.org/v1" });
    expect(await deployment.resolveApiBase()).toBe("https://misty.example.org/v1");
    expect(deployment.resolveHostedApiBase()).toBe("https://misty.example.org/v1");
    expect(saved.state).toEqual({
      version: 1,
      choice: { mode: "server", url: "https://misty.example.org/v1" },
    });
    await choice.saveServerChoice({ mode: "none" });
    expect(await deployment.resolveApiBase()).toBe("");
  });

  it("forgets a saved server a release build can't use", async () => {
    saved.state = { version: 1, choice: { mode: "server", url: "http://127.0.0.1:8081/v1" } };
    vi.stubEnv("DEV", false);
    vi.resetModules();
    const release = await import("@/api/deployment/serverChoice");
    expect(await release.loadServerChoice()).toBeNull();
    expect(release.currentApiBase()).toBe("");
    vi.unstubAllEnvs();
  });

  it("tries a read that failed again before counting it as no server chosen", async () => {
    const chosen = { mode: "server", url: "https://misty.example.org/v1" };
    saved.state = { version: 1, choice: chosen };
    vi.resetModules();
    const { invoke } = await import("@/native/invoke");
    const fresh = await import("@/api/deployment/serverChoice");
    vi.useFakeTimers();
    try {
      vi.mocked(invoke)
        .mockRejectedValueOnce(new Error("busy"))
        .mockRejectedValueOnce(new Error("busy"));
      const loaded = fresh.loadServerChoice();
      await vi.advanceTimersByTimeAsync(250 + 500);
      expect(await loaded).toEqual(chosen);
      expect(fresh.useServerChoice.getState()).toMatchObject({ loaded: true, choice: chosen });
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts a read that keeps failing as no server chosen", async () => {
    saved.state = { version: 1, choice: { mode: "server", url: "https://misty.example.org/v1" } };
    vi.resetModules();
    const { invoke } = await import("@/native/invoke");
    const fresh = await import("@/api/deployment/serverChoice");
    vi.useFakeTimers();
    try {
      vi.mocked(invoke).mockClear();
      for (let attempt = 0; attempt < 4; attempt++)
        vi.mocked(invoke).mockRejectedValueOnce(new Error("busy"));
      const loaded = fresh.loadServerChoice();
      await vi.advanceTimersByTimeAsync(250 + 500 + 750);
      expect(await loaded).toBeNull();
      expect(vi.mocked(invoke)).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("namespaces local state under the Hosted scope", () => {
    expect(deployment.readDeploymentScope()).toBe("hosted");
    expect(deployment.deploymentStorageKey("misty:example")).toBe("misty:example:hosted");
  });

  it("falls back to state written before namespacing", () => {
    localStorage.setItem("misty:example", "legacy");
    expect(deployment.readDeploymentStorageItem("misty:example")).toBe("legacy");
    localStorage.setItem("misty:example:hosted", "current");
    expect(deployment.readDeploymentStorageItem("misty:example")).toBe("current");
  });
});
