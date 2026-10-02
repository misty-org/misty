import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RECENT_TOOLS, useRecentToolsStore } from "./useRecentToolsStore";

const mocks = vi.hoisted(() => ({ recordAppActivity: vi.fn(async () => undefined) }));

vi.mock("@/api/home/api", () => ({
  homeApi: { recordAppActivity: mocks.recordAppActivity },
}));

describe("useRecentToolsStore", () => {
  beforeEach(() => {
    mocks.recordAppActivity.mockClear();
    useRecentToolsStore.persist.clearStorage();
    useRecentToolsStore.getState().resetRecentTools();
  });

  it("initializes with the default 5 recent tools", () => {
    expect(useRecentToolsStore.getState().recentTools).toEqual(DEFAULT_RECENT_TOOLS);
  });

  it("records tool usage and moves it to the front", () => {
    useRecentToolsStore.getState().recordToolUsage("files");
    expect(useRecentToolsStore.getState().recentTools[0]).toBe("files");

    useRecentToolsStore.getState().recordToolUsage("agents");
    expect(useRecentToolsStore.getState().recentTools[0]).toBe("agents");
    expect(useRecentToolsStore.getState().recentTools[1]).toBe("files");
    expect(mocks.recordAppActivity).toHaveBeenNthCalledWith(1, "files");
    expect(mocks.recordAppActivity).toHaveBeenNthCalledWith(2, "agents");
  });

  it("hydrates account recents ahead of defaults", () => {
    useRecentToolsStore.getState().hydrateRecentTools(["browser", "agents"]);
    expect(useRecentToolsStore.getState().recentTools.slice(0, 2)).toEqual(["browser", "agents"]);
  });

  it("deduplicates recent tools and caps at 10 items", () => {
    useRecentToolsStore.getState().recordToolUsage("browser");
    useRecentToolsStore.getState().recordToolUsage("browser");
    const occurrences = useRecentToolsStore
      .getState()
      .recentTools.filter((tool) => tool === "browser");
    expect(occurrences).toHaveLength(1);
  });
});
