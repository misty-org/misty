import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RECENT_TOOLS,
  toolIdFromSurfaceId,
  toolIdFromTab,
  useRecentToolsStore,
} from "./useRecentToolsStore";

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
    useRecentToolsStore.getState().recordToolUsage("terminal");
    expect(useRecentToolsStore.getState().recentTools[0]).toBe("terminal");

    useRecentToolsStore.getState().recordToolUsage("inbox");
    expect(useRecentToolsStore.getState().recentTools[0]).toBe("inbox");
    expect(useRecentToolsStore.getState().recentTools[1]).toBe("terminal");
    expect(mocks.recordAppActivity).toHaveBeenNthCalledWith(1, "terminal");
    expect(mocks.recordAppActivity).toHaveBeenNthCalledWith(2, "inbox");
  });

  it("hydrates account recents ahead of defaults", () => {
    useRecentToolsStore.getState().hydrateRecentTools(["browser", "agents"]);
    expect(useRecentToolsStore.getState().recentTools.slice(0, 2)).toEqual(["browser", "agents"]);
  });

  it("deduplicates recent tools and caps at 10 items", () => {
    useRecentToolsStore.getState().recordToolUsage("code");
    useRecentToolsStore.getState().recordToolUsage("code");
    const occurrences = useRecentToolsStore
      .getState()
      .recentTools.filter((tool) => tool === "code");
    expect(occurrences).toHaveLength(1);
  });

  it("correctly identifies tool IDs from tabs and surface IDs", () => {
    expect(toolIdFromTab({ surfaceId: "space", route: "/spaces/1/notes" })).toBe("journal");
    expect(toolIdFromTab({ surfaceId: "space", route: "/spaces/1/planner" })).toBe("planner");
    expect(toolIdFromTab({ surfaceId: "space", route: "/spaces/1/chat" })).toBe("social");
    expect(toolIdFromTab({ surfaceId: "space", route: "/spaces/1/library" })).toBe("library");
    expect(toolIdFromTab({ surfaceId: "code", route: "/code" })).toBe("code");
    expect(toolIdFromTab({ surfaceId: "terminal", route: "/terminal" })).toBe("terminal");

    expect(toolIdFromSurfaceId("space", "Journal")).toBe("journal");
    expect(toolIdFromSurfaceId("space", "Planner")).toBe("planner");
    expect(toolIdFromSurfaceId("browser", "Browser")).toBe("browser");
  });
});
