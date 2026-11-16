import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineInfo } from "./enginesApi";

const state = vi.hoisted(() => ({
  settings: { document: {} as Record<string, Record<string, unknown>> },
  agents: [] as { id: string; engine?: string; enabled: boolean }[],
}));

vi.mock("@/features/settings", () => ({
  useSettingsStore: { getState: () => ({ settings: state.settings }) },
}));
vi.mock("../personal/personalAgentsStore", () => ({
  usePersonalAgentsStore: { getState: () => ({ agents: state.agents }) },
}));
vi.mock("./enginesApi", () => ({ useEnginesList: () => ({ data: undefined }) }));

const {
  canBeDefault,
  defaultChoices,
  defaultEngineAgent,
  resolveDefaultEngine,
  savedDefaultEngine,
} = await import("./defaultEngine");

const engine = (id: string, change: Partial<EngineInfo> = {}): EngineInfo => ({
  id,
  name: id,
  installed: true,
  version: "1.0",
  supportsImages: true,
  supportsMcp: true,
  supportsWebSearch: true,
  ...change,
});

beforeEach(() => {
  state.settings = { document: {} };
  state.agents = [];
});

describe("the default engine", () => {
  it("is only an installed engine that takes images, mounts Misty's tools and searches the web", () => {
    expect(canBeDefault(engine("claude"))).toBe(true);
    expect(canBeDefault(engine("claude", { installed: false }))).toBe(false);
    expect(canBeDefault(engine("claude", { supportsImages: false }))).toBe(false);
    expect(canBeDefault(engine("claude", { supportsMcp: undefined }))).toBe(false);
    expect(canBeDefault(engine("opencode", { supportsWebSearch: false }))).toBe(false);
  });

  it("offers Claude, then Codex, then Gemini, then the rest", () => {
    const choices = defaultChoices([
      engine("other"),
      engine("gemini"),
      engine("opencode", { supportsWebSearch: false }),
      engine("codex"),
      engine("claude"),
    ]);
    expect(choices.map((item) => item.id)).toEqual(["claude", "codex", "gemini", "other"]);
  });

  it("keeps the saved engine while it can still be the default", () => {
    const engines = [engine("claude"), engine("codex")];
    expect(resolveDefaultEngine(engines, "codex").engine?.id).toBe("codex");
    expect(resolveDefaultEngine(engines, "gemini").engine?.id).toBe("claude");
    expect(
      resolveDefaultEngine([engine("claude"), engine("codex", { installed: false })], "codex")
        .engine?.id,
    ).toBe("claude");
  });

  it("isn't ready until the engines are read, and is none when none can be", () => {
    expect(resolveDefaultEngine(undefined, "claude")).toEqual({ choices: [], ready: false });
    expect(resolveDefaultEngine([engine("opencode", { supportsMcp: false })], "")).toEqual({
      engine: undefined,
      choices: [],
      ready: true,
    });
  });

  it("reads the saved engine from the agent settings", () => {
    expect(savedDefaultEngine()).toBe("");
    state.settings = { document: { agent: { default_engine: "codex" } } };
    expect(savedDefaultEngine()).toBe("codex");
    expect(resolveDefaultEngine([engine("claude"), engine("codex")]).engine?.id).toBe("codex");
  });

  it("runs as its own agent, else any of the person's on it, else none", () => {
    state.agents = [
      { id: "personal_mine", engine: "claude", enabled: true },
      { id: "personal_engine_claude", engine: "claude", enabled: true },
      { id: "personal_off", engine: "codex", enabled: false },
    ];
    expect(defaultEngineAgent("claude")).toBe("personal_engine_claude");
    state.agents = state.agents.filter((agent) => agent.id !== "personal_engine_claude");
    expect(defaultEngineAgent("claude")).toBe("personal_mine");
    expect(defaultEngineAgent("codex")).toBeUndefined();
  });
});
