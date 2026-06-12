import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchResult } from "@/native/contracts";
import { useExplorerStore } from "../store";
import {
  revealSearchResultInPane,
  searchResultNavigationTarget,
  searchResultStaleMessage,
} from "./searchNavigation";

describe("searchNavigation", () => {
  beforeEach(() => {
    useExplorerStore.setState({
      panes: {},
      operationError: null,
    });
  });

  describe("searchResultNavigationTarget", () => {
    it("targets parent directory for files on Unix paths", () => {
      const result: SearchResult = {
        entry: {
          id: "/home/user/docs/report.pdf",
          name: "report.pdf",
          path: "/home/user/docs/report.pdf",
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
        score: 1,
        sourceKind: "local",
        indexedAtMs: 12345,
      };

      const target = searchResultNavigationTarget(result);
      expect(target.path).toBe("/home/user/docs");
      expect(target.selectEntryId).toBe("/home/user/docs/report.pdf");
      expect(target.result).toBe(result);
    });

    it("targets folder itself for folder entries", () => {
      const result: SearchResult = {
        entry: {
          id: "/home/user/docs",
          name: "docs",
          path: "/home/user/docs",
          extension: "",
          mimeType: null,
          remoteModified: null,
          kind: "folder",
          sizeBytes: null,
          modifiedMs: null,
          createdMs: null,
          readonly: false,
          hidden: false,
          location: { kind: "local", providerType: null, remoteName: null, remotePath: null },
        },
        score: 1,
        sourceKind: "local",
        indexedAtMs: 12345,
      };

      const target = searchResultNavigationTarget(result);
      expect(target.path).toBe("/home/user/docs");
      expect(target.selectEntryId).toBeNull();
    });

    it("correctly handles Windows drive paths and backslashes", () => {
      const result: SearchResult = {
        entry: {
          id: "C:\\Users\\User\\Documents\\notes.txt",
          name: "notes.txt",
          path: "C:\\Users\\User\\Documents\\notes.txt",
          extension: "txt",
          mimeType: "text/plain",
          remoteModified: null,
          kind: "file",
          sizeBytes: 500,
          modifiedMs: null,
          createdMs: null,
          readonly: false,
          hidden: false,
          location: { kind: "local", providerType: null, remoteName: null, remotePath: null },
        },
        score: 1,
        sourceKind: "local",
        indexedAtMs: 12345,
      };

      const target = searchResultNavigationTarget(result);
      expect(target.path).toBe("C:/Users/User/Documents");
      expect(target.selectEntryId).toBe("C:\\Users\\User\\Documents\\notes.txt");
    });

    it("handles files in drive root on Windows", () => {
      const result: SearchResult = {
        entry: {
          id: "C:\\file.txt",
          name: "file.txt",
          path: "C:\\file.txt",
          extension: "txt",
          mimeType: "text/plain",
          remoteModified: null,
          kind: "file",
          sizeBytes: 500,
          modifiedMs: null,
          createdMs: null,
          readonly: false,
          hidden: false,
          location: { kind: "local", providerType: null, remoteName: null, remotePath: null },
        },
        score: 1,
        sourceKind: "local",
        indexedAtMs: 12345,
      };

      const target = searchResultNavigationTarget(result);
      expect(target.path).toBe("C:/");
    });

    it("handles files in root on Unix", () => {
      const result: SearchResult = {
        entry: {
          id: "/root_file.txt",
          name: "root_file.txt",
          path: "/root_file.txt",
          extension: "txt",
          mimeType: "text/plain",
          remoteModified: null,
          kind: "file",
          sizeBytes: 100,
          modifiedMs: null,
          createdMs: null,
          readonly: false,
          hidden: false,
          location: { kind: "local", providerType: null, remoteName: null, remotePath: null },
        },
        score: 1,
        sourceKind: "local",
        indexedAtMs: 12345,
      };

      const target = searchResultNavigationTarget(result);
      expect(target.path).toBe("/");
    });
  });

  describe("revealSearchResultInPane", () => {
    it("navigates pane to target path and selects matching entry", async () => {
      const navigatePaneSpy = vi.fn().mockImplementation(async (paneId: string, path: string) => {
        useExplorerStore.setState({
          panes: {
            [paneId]: {
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
                path,
                parentPath: "/home/user",
                entries: [
                  {
                    id: "/home/user/docs/other.txt",
                    name: "other.txt",
                    path: "/home/user/docs/other.txt",
                    extension: "txt",
                    mimeType: "text/plain",
                    remoteModified: null,
                    kind: "file",
                    sizeBytes: 10,
                    modifiedMs: null,
                    createdMs: null,
                    readonly: false,
                    hidden: false,
                    location: {
                      kind: "local",
                      providerType: null,
                      remoteName: null,
                      remotePath: null,
                    },
                  },
                  {
                    id: "/home/user/docs/report.pdf",
                    name: "report.pdf",
                    path: "/home/user/docs/report.pdf",
                    extension: "pdf",
                    mimeType: "application/pdf",
                    remoteModified: null,
                    kind: "file",
                    sizeBytes: 1024,
                    modifiedMs: null,
                    createdMs: null,
                    readonly: false,
                    hidden: false,
                    location: {
                      kind: "local",
                      providerType: null,
                      remoteName: null,
                      remotePath: null,
                    },
                  },
                ],
                location: { kind: "local", providerType: null, remoteName: null, remotePath: null },
                totalCount: 2,
                hiddenCount: 0,
              },
            },
          },
        });
      });

      const selectEntrySpy = vi.fn().mockImplementation((paneId: string, entryId: string) => {
        useExplorerStore.setState((state) => ({
          panes: {
            ...state.panes,
            [paneId]: {
              ...(state.panes[paneId] as any),
              selectedIds: [entryId],
            },
          },
        }));
      });

      useExplorerStore.setState({
        navigatePane: navigatePaneSpy,
        selectEntry: selectEntrySpy,
      });

      const result: SearchResult = {
        entry: {
          id: "/home/user/docs/report.pdf",
          name: "report.pdf",
          path: "/home/user/docs/report.pdf",
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
        score: 1,
        sourceKind: "local",
        indexedAtMs: 12345,
      };

      const target = searchResultNavigationTarget(result);
      await revealSearchResultInPane("pane-1", target);

      expect(navigatePaneSpy).toHaveBeenCalledWith("pane-1", "/home/user/docs");
      expect(selectEntrySpy).toHaveBeenCalledWith("pane-1", "/home/user/docs/report.pdf");
      expect(useExplorerStore.getState().operationError).toBeNull();
    });
  });

  describe("searchResultStaleMessage", () => {
    it("returns formatted error message", () => {
      const result: SearchResult = {
        entry: {
          id: "/test",
          name: "test",
          path: "/test",
          extension: "",
          mimeType: null,
          remoteModified: null,
          kind: "file",
          sizeBytes: null,
          modifiedMs: null,
          createdMs: null,
          readonly: false,
          hidden: false,
          location: { kind: "local", providerType: null, remoteName: null, remotePath: null },
        },
        score: 1,
        sourceKind: "local",
        indexedAtMs: 12345,
      };
      expect(searchResultStaleMessage(result)).toContain("local disk");
    });
  });
});
