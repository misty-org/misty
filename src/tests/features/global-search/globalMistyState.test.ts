import { beforeEach, describe, expect, it } from "vitest";
import { useGlobalSearchStore } from "@/features/global-search";

describe("Global Misty state", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useGlobalSearchStore.getState().setAccount("");
    useGlobalSearchStore.setState({ launcherOpen: false, open: false, working: false });
  });

  it("remembers the last mode independently for each account", () => {
    useGlobalSearchStore.getState().setAccount("account-a");
    useGlobalSearchStore.getState().setMode("action");
    useGlobalSearchStore.getState().setAccount("account-b");
    expect(useGlobalSearchStore.getState().mode).toBe("search");

    useGlobalSearchStore.getState().setAccount("account-a");
    expect(useGlobalSearchStore.getState().mode).toBe("action");
  });

  it("collapses without canceling background work", () => {
    useGlobalSearchStore.setState({ launcherOpen: false, open: true, working: true });
    useGlobalSearchStore.getState().closePanel();
    expect(useGlobalSearchStore.getState()).toMatchObject({ open: false, working: true });
  });

  it("deduplicates context by its semantic destination", () => {
    useGlobalSearchStore.getState().setContext([
      {
        id: "route:/spaces/space-1/chat",
        kind: "route",
        title: "Current Space view",
        href: "/spaces/space-1/chat",
        source: "current",
        spaceId: "space-1",
      },
      {
        id: "route:/spaces/space-1/planner",
        kind: "route",
        title: "Current Space view",
        href: "/spaces/space-1/planner",
        source: "current",
        spaceId: "space-1",
      },
      {
        id: "file-one",
        kind: "file",
        title: "Plan.md",
        source: "current",
        localPath: "/tmp/Plan.md",
      },
      {
        id: "file-two",
        kind: "file",
        title: "Plan.md",
        source: "current",
        localPath: "/tmp/Plan.md",
      },
    ]);

    expect(useGlobalSearchStore.getState().context).toHaveLength(2);
  });
});
