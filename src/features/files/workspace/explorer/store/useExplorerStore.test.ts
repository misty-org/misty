import { beforeEach, describe, expect, it, vi } from "vitest";
import { useExplorerStore } from ".";

describe("Explorer operation notices", () => {
  beforeEach(() => {
    useExplorerStore.setState({ operationError: null });
  });

  it("consumes a recovery notice exactly once", () => {
    const message = "Misty reset a damaged Explorer layout and opened a clean file pane.";
    useExplorerStore.setState({ operationError: message });

    expect(useExplorerStore.getState().consumeOperationError()).toBe(message);
    expect(useExplorerStore.getState().operationError).toBeNull();
    expect(useExplorerStore.getState().consumeOperationError()).toBeNull();
  });
});

it("opens Transfers without a directory request and preserves back navigation", async () => {
  const { useMultiPanelStore } = await import("@/features/workspace");
  const { emptyPaneState } = await import("./helpers/selection");
  useMultiPanelStore.getState().initialize("/Users/test", "Files");
  const paneId = useMultiPanelStore.getState().activePaneId;
  useExplorerStore.setState({
    panes: {
      [paneId]: {
        ...emptyPaneState(),
        listing: {
          path: "/Users/test",
          parentPath: "/Users",
          entries: [],
          totalCount: 0,
          hiddenCount: 0,
          location: { kind: "local", providerType: null, remoteName: null, remotePath: null },
        },
      },
    },
  });
  await useExplorerStore.getState().navigatePane(paneId, "misty-transfers://history");
  expect(useMultiPanelStore.getState().tabs.find((tab) => tab.activePaneId === paneId)?.title).toBe(
    "Transfers",
  );
  expect(useExplorerStore.getState().panes[paneId].listing?.path).toBe("misty-transfers://history");
  expect(useExplorerStore.getState().panes[paneId].backHistory).toEqual(["/Users/test"]);
});

it("does not let a slow folder listing replace the Transfers page", async () => {
  const native = await import("../../native");
  const { useMultiPanelStore } = await import("@/features/workspace");
  const { emptyPaneState } = await import("./helpers/selection");
  useMultiPanelStore.getState().initialize("/Users/test", "Files");
  const paneId = useMultiPanelStore.getState().activePaneId;
  useExplorerStore.setState({ panes: { [paneId]: emptyPaneState() } });
  let finish!: (value: Awaited<ReturnType<typeof native.explorerListDirectory>>) => void;
  const listing = vi.spyOn(native, "explorerListDirectory").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  try {
    const opening = useExplorerStore.getState().navigatePane(paneId, "/Users/test/slow");
    await useExplorerStore.getState().navigatePane(paneId, "misty-transfers://history");
    finish({
      path: "/Users/test/slow",
      parentPath: "/Users/test",
      entries: [],
      totalCount: 0,
      hiddenCount: 0,
      location: { kind: "local", providerType: null, remoteName: null, remotePath: null },
    });
    await opening;
    expect(useExplorerStore.getState().panes[paneId].listing?.path).toBe(
      "misty-transfers://history",
    );
  } finally {
    listing.mockRestore();
  }
});
