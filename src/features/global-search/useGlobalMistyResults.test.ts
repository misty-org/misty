import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useExplorerStore } from "@/features/files/explorer";
import { dockTabs, useMultiPanelStore, useWorkspaceStore } from "@/features/workspace";
import type { GlobalSearchResult } from "./types";
import { useGlobalMistyResults } from "./useGlobalMistyResults";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

describe("useGlobalMistyResults", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    useWorkspaceStore.setState({
      activeScopeKey: "global",
      virtualWindowsByScope: {},
      closedVirtualWindowsByScope: {},
      lastUsedTabByGroup: {},
      layout: {
        root: {
          id: "pane-1",
          type: "leaf",
          activeTabId: "tab-1",
          tabs: [
            {
              id: "tab-1",
              surfaceId: "files",
              groupKey: "tool:files",
              instanceKey: "files:test",
              title: "Files",
              route: "/files",
              sidebarVisible: true,
              state: {},
              createdAt: 1,
              lastFocusedAt: 1,
            },
          ],
        },
        focusedPaneId: "pane-1",
      },
    });

    useMultiPanelStore.setState({
      activePaneId: "explorer-pane-0",
      activeTabId: "browse-tab-0",
      tabs: [
        {
          id: "browse-tab-0",
          title: "Files",
          path: "/home/user",
          activePaneId: "explorer-pane-0",
          panes: [{ id: "explorer-pane-0", title: "Home", path: "/home/user" }],
          layout: { orientation: "horizontal", paneIds: ["explorer-pane-0"] },
        },
      ],
    });

    useExplorerStore.setState({
      panes: {
        "explorer-pane-0": {
          loading: false,
          showLoadingSkeleton: false,
          needsLoad: false,
          hasFolderEntries: false,
          commandQuery: "",
          commandQueryMode: "search",
          error: null,
          selectedIds: [],
          selectedIdsByPath: {},
          lastSelectedIndexByPath: {},
          backHistory: [],
          forwardHistory: [],
          listing: {
            path: "/home/user/docs",
            parentPath: "/home/user",
            entries: [
              {
                id: "/home/user/docs/my-file.pdf",
                name: "my-file.pdf",
                path: "/home/user/docs/my-file.pdf",
                extension: "pdf",
                mimeType: "application/pdf",
                remoteModified: null,
                kind: "file",
                sizeBytes: 1024,
                modifiedMs: null,
                createdMs: null,
                readonly: false,
                hidden: false,
                location: { kind: "local", providerType: null, remoteName: null, remotePath: null },
              },
            ],
            location: { kind: "local", providerType: null, remoteName: null, remotePath: null },
            totalCount: 1,
            hiddenCount: 0,
          },
        },
      },
      navigatePane: vi.fn().mockResolvedValue(undefined),
      selectEntry: vi.fn(),
    });
  });

  it("navigates to files and reveals location when clicking a file result", async () => {
    const closePanel = vi.fn();
    const setContext = vi.fn();

    const { result } = renderHook(() =>
      useGlobalMistyResults({
        activePaneId: "explorer-pane-0",
        context: [],
        setContext,
        closePanel,
      }),
    );

    const fileResult: GlobalSearchResult = {
      id: "file:/home/user/docs/my-file.pdf",
      accountId: "acc-1",
      kind: "file",
      title: "my-file.pdf",
      body: "Sample content",
      keywords: ["pdf"],
      href: "/files",
      source: "device",
      score: 100,
      fileResult: {
        entry: {
          id: "/home/user/docs/my-file.pdf",
          name: "my-file.pdf",
          path: "/home/user/docs/my-file.pdf",
          extension: "pdf",
          mimeType: "application/pdf",
          remoteModified: null,
          kind: "file",
          sizeBytes: 1024,
          modifiedMs: null,
          createdMs: null,
          readonly: false,
          hidden: false,
          location: { kind: "local", providerType: null, remoteName: null, remotePath: null },
        },
        score: 100,
        sourceKind: "local",
        indexedAtMs: 12345,
      },
    };

    await result.current.openResult(fileResult);

    expect(closePanel).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith(
      "/apps/files?path=%2Fhome%2Fuser%2Fdocs%2Fmy-file.pdf",
    );

    // The files workspace surface should be focused
    const currentTab = dockTabs(useWorkspaceStore.getState().layout.root).find(
      (tab) => tab.surfaceId === "official-app" && tab.groupKey === "app:files",
    );
    expect(currentTab).toBeDefined();
  });

  it("navigates to route directly when clicking non-file result", async () => {
    const closePanel = vi.fn();
    const setContext = vi.fn();

    const { result } = renderHook(() =>
      useGlobalMistyResults({
        activePaneId: "explorer-pane-0",
        context: [],
        setContext,
        closePanel,
      }),
    );

    const spaceResult: GlobalSearchResult = {
      id: "space:space-1",
      accountId: "acc-1",
      kind: "space",
      title: "Engineering",
      body: "Engineering space",
      keywords: ["engineering"],
      href: "/spaces/space-1",
      source: "local",
      score: 100,
    };

    await result.current.openResult(spaceResult);

    expect(closePanel).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/spaces/space-1");
  });
});
