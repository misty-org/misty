import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/features/workspace";
import type { GlobalSearchResult } from "./types";
import { useGlobalMistyResults } from "./useGlobalMistyResults";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));
const mockKuraOpen = vi.fn();
vi.mock("@/native/kura", () => ({
  kuraOpen: (link: unknown) => mockKuraOpen(link),
}));

describe("useGlobalMistyResults", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockKuraOpen.mockReset().mockResolvedValue(undefined);
    useWorkspaceStore.setState({
      activeScopeKey: "global",
      windowsByScope: {},
      closedWindowsByScope: {},
      lastUsedViewByGroup: {},
      layout: {
        root: {
          id: "pane-1",
          type: "leaf",
          activeViewId: "tab-1",
          views: [
            {
              id: "tab-1",
              surfaceId: "browser",
              groupKey: "tool:browser",
              instanceKey: "browser:test",
              title: "New Tab",
              route: "/browser",
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
  });

  it("hands a file result to Kura with the file selected", async () => {
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
    expect(mockKuraOpen).toHaveBeenCalledWith({
      action: "open",
      path: "/home/user/docs",
      select: "/home/user/docs/my-file.pdf",
    });
    expect(mockNavigate).not.toHaveBeenCalled();
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
