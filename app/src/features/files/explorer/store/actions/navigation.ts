import { useMultiPanelStore } from "@/features/workspace";
import {
  explorerCalculateDirectorySizes,
  explorerDirectorySizeSnapshot,
  explorerListDirectory,
} from "@/features/files/native";
import type { DirectorySizeRecord } from "@/native/contracts";
import { errorText, userFacingErrorText } from "@/shared/lib/format";
import type { ExplorerStore } from "../../model/interfaces/store/types";
import type {
  ExplorerGet,
  ExplorerSet,
  ExplorerSortDirection,
} from "../../model/types/store/types";
import * as H from "../helpers";
import { explorerRuntime } from "../runtime";

export function createNavigationActions(
  set: ExplorerSet,
  get: ExplorerGet,
): Partial<ExplorerStore> {
  return {
    loadPane: (paneId, path, mode = "push", options) => {
      path = H.normalizedPath(path);
      if (H.isExplorerInternalTabPath(path)) {
        set((state) => ({
          panes: {
            ...state.panes,
            [paneId]: {
              ...(state.panes[paneId] ?? H.emptyPaneState()),
              loading: false,
              showLoadingSkeleton: false,
              needsLoad: false,
              error: null,
            },
          },
        }));
        return Promise.resolve();
      }
      const loadKey = [
        paneId,
        path,
        mode,
        H.showHiddenForPane(get(), paneId) ? "hidden" : "visible",
        options?.forceRemoteRefresh ? "force" : "cached",
      ].join("\0");
      const pendingLoad = explorerRuntime.paneLoadRequestsInFlight.get(loadKey);
      if (pendingLoad) return pendingLoad;

      const loadRequest = (async () => {
        set((state) => {
          const pane = state.panes[paneId] ?? H.emptyPaneState();
          const multi = useMultiPanelStore.getState();
          const tab = multi.tabs.find((candidate) =>
            candidate.panes.some((candidatePane) => candidatePane.id === paneId),
          );
          const sibling =
            tab?.panes.find(
              (candidatePane) => candidatePane.id !== paneId && candidatePane.path === path,
            ) ?? tab?.panes.find((candidatePane) => candidatePane.id !== paneId);
          const paneViewModes =
            state.paneViewModes[paneId] === undefined
              ? {
                  ...state.paneViewModes,
                  [paneId]: sibling ? H.viewModeForPane(state, sibling.id) : state.viewMode,
                }
              : state.paneViewModes;
          const paneFileItemScales =
            state.paneFileItemScales[paneId] === undefined
              ? {
                  ...state.paneFileItemScales,
                  [paneId]: sibling
                    ? (state.paneFileItemScales[sibling.id] ?? state.fileItemScale)
                    : state.fileItemScale,
                }
              : state.paneFileItemScales;
          const paneShowHidden =
            state.paneShowHidden[paneId] === undefined
              ? {
                  ...state.paneShowHidden,
                  [paneId]: sibling ? H.showHiddenForPane(state, sibling.id) : state.showHidden,
                }
              : state.paneShowHidden;
          const quietRefresh =
            !options?.forceRemoteRefresh &&
            mode === "replace" &&
            pane.listing?.path === path &&
            !pane.needsLoad;
          const nextPane = quietRefresh
            ? pane.error
              ? { ...pane, error: null }
              : pane
            : {
                ...pane,
                loading: true,
                showLoadingSkeleton: H.shouldShowLoadingSkeleton(pane, path),
                needsLoad: false,
                error: null,
              };
          if (
            nextPane === pane &&
            state.inlineEdit?.paneId !== paneId &&
            paneViewModes === state.paneViewModes &&
            paneFileItemScales === state.paneFileItemScales &&
            paneShowHidden === state.paneShowHidden
          )
            return state;
          return {
            inlineEdit: state.inlineEdit?.paneId === paneId ? null : state.inlineEdit,
            paneViewModes,
            paneFileItemScales,
            paneShowHidden,
            panes: {
              ...state.panes,
              [paneId]: nextPane,
            },
          };
        });
        try {
          const listing = H.sortListing(
            H.normalizeDirectoryListingPaths(
              await explorerListDirectory({
                path,
                showHidden: H.showHiddenForPane(get(), paneId),
                forceRemoteRefresh: options?.forceRemoteRefresh,
              }),
            ),
            H.sortForPane(get(), paneId),
            get().directorySizes,
          );
          if (mode !== "replace") void get().recordLastOpenedPath(listing.path);
          const multi = useMultiPanelStore.getState();
          const tab = multi.tabs.find((candidate) =>
            candidate.panes.some((pane) => pane.id === paneId),
          );
          const pane = tab?.panes.find((candidate) => candidate.id === paneId);
          const listingTitle = listing.title?.trim() || H.titleFromPath(listing.path);
          if (pane?.path !== listing.path || pane?.title !== listingTitle) {
            multi.updateActiveTabPath(paneId, listing.path, listingTitle);
          }
          set((state) => {
            const currentPane = state.panes[paneId] ?? H.emptyPaneState();
            if (
              mode === "replace" &&
              currentPane.listing &&
              H.directoryListingsEqual(currentPane.listing, listing) &&
              !currentPane.loading &&
              !currentPane.error
            ) {
              return state;
            }
            const nextPane = H.applyNavigationResult(currentPane, listing, mode);
            if (H.paneExplorerStatesEqual(currentPane, nextPane)) return state;
            return {
              panes: {
                ...state.panes,
                [paneId]: nextPane,
              },
            };
          });
          void get().loadDirectorySizeSnapshot(H.folderPathsForListing(listing));
        } catch (error) {
          set((state) => ({
            panes: {
              ...state.panes,
              [paneId]: {
                ...(state.panes[paneId] ?? H.emptyPaneState()),
                loading: false,
                showLoadingSkeleton: false,
                needsLoad: false,
                error: userFacingErrorText(error),
              },
            },
          }));
        }
      })();

      explorerRuntime.paneLoadRequestsInFlight.set(loadKey, loadRequest);
      void loadRequest.finally(() => {
        if (explorerRuntime.paneLoadRequestsInFlight.get(loadKey) === loadRequest) {
          explorerRuntime.paneLoadRequestsInFlight.delete(loadKey);
        }
      });
      return loadRequest;
    },

    navigatePane: async (paneId, path) => {
      await get().loadPane(paneId, path, "push");
    },

    navigateBack: async (paneId) => {
      const history = get().panes[paneId]?.backHistory ?? [];
      const target = history[history.length - 1];
      if (target) await get().loadPane(paneId, target, "back");
    },

    navigateForward: async (paneId) => {
      const history = get().panes[paneId]?.forwardHistory ?? [];
      const target = history[history.length - 1];
      if (target) await get().loadPane(paneId, target, "forward");
    },

    navigateParent: async (paneId) => {
      const parent = get().panes[paneId]?.listing?.parentPath;
      if (parent) {
        await get().loadPane(paneId, parent, "push");
      }
    },

    refreshPane: async (paneId) => {
      const path = get().panes[paneId]?.listing?.path;
      if (path) {
        await get().loadPane(paneId, path, "replace", { forceRemoteRefresh: true });
      }
    },

    loadDirectorySizeSnapshot: async (paths, options) => {
      const uniquePaths = H.uniqueDirectorySizePaths(paths);
      if (uniquePaths.length === 0) return;
      try {
        const records = await explorerDirectorySizeSnapshot(uniquePaths);
        H.mergeDirectorySizeRecords(set, records);
        if (options?.calculateMissing) {
          const missing = records
            .filter((record) => record.status === "unknown")
            .map((record) => record.path);
          if (missing.length > 0) {
            void get().calculateDirectorySizes(missing, { force: false, notify: false });
          }
        }
      } catch {
        // Directory sizes are progressive metadata and should not block listing work.
      }
    },

    calculateDirectorySizes: async (paths, options) => {
      const uniquePaths = H.uniqueDirectorySizePaths(paths);
      if (uniquePaths.length === 0) return;
      H.markDirectorySizesCalculating(set, uniquePaths);
      try {
        const records = await explorerCalculateDirectorySizes({
          paths: uniquePaths,
          force: options?.force ?? false,
        });
        H.mergeDirectorySizeRecords(set, records);
        if (options?.notify) {
          const failed = records.filter((record) => record.status === "failed");
          if (failed.length > 0) {
            get().pushNotification(
              `Folder size failed: ${failed[0].error ?? "Unable to calculate folder size."}`,
              "error",
              5000,
            );
          } else {
            get().pushNotification(
              records.length === 1 ? "Folder size updated" : "Folder sizes updated",
              "success",
              2500,
            );
          }
        }
      } catch (error) {
        H.markDirectorySizesFailed(set, uniquePaths, errorText(error));
        if (options?.notify) {
          get().pushNotification(`Folder size failed: ${errorText(error)}`, "error", 5000);
        }
      }
    },

    calculatePaneDirectorySizes: async (paneId, options) => {
      const pane = get().panes[paneId];
      await get().calculateDirectorySizes(H.folderPathsForListing(pane?.listing ?? null), {
        force: options?.force ?? true,
        notify: options?.notify ?? true,
      });
    },

    runScheduledDirectorySizeRefresh: async () => {
      const paths = H.openPaneDirectorySizePaths(get());
      if (paths.length === 0) return;
      let records: DirectorySizeRecord[];
      try {
        records = await explorerDirectorySizeSnapshot(paths);
        H.mergeDirectorySizeRecords(set, records);
      } catch {
        return;
      }
    },

    setViewMode: (viewMode, paneId) =>
      set((state) => {
        const targetPaneId = paneId ?? useMultiPanelStore.getState().activePaneId;
        if (!targetPaneId) return state.viewMode === viewMode ? state : { viewMode };
        if (state.viewMode === viewMode && state.paneViewModes[targetPaneId] === viewMode)
          return state;
        return {
          viewMode,
          paneViewModes: { ...state.paneViewModes, [targetPaneId]: viewMode },
        };
      }),
    setFileItemScale: (scale, paneId) =>
      set((state) => {
        const nextScale = Math.min(2, Math.max(0, Math.round(scale)));
        const targetPaneId = paneId ?? useMultiPanelStore.getState().activePaneId;
        if (!targetPaneId)
          return state.fileItemScale === nextScale ? state : { fileItemScale: nextScale };
        if (
          state.fileItemScale === nextScale &&
          state.paneFileItemScales[targetPaneId] === nextScale
        )
          return state;
        return {
          fileItemScale: nextScale,
          paneFileItemScales: { ...state.paneFileItemScales, [targetPaneId]: nextScale },
        };
      }),
    setSort: (column, paneId) => {
      set((state) => {
        const targetPaneId = paneId ?? useMultiPanelStore.getState().activePaneId;
        const currentSort = targetPaneId ? H.sortForPane(state, targetPaneId) : state.sort;
        const direction: ExplorerSortDirection =
          currentSort.column === column && currentSort.direction === "asc" ? "desc" : "asc";
        const sort = { column, direction };
        if (!targetPaneId) return { sort };
        const pane = state.panes[targetPaneId];
        return {
          sort,
          paneSorts: { ...state.paneSorts, [targetPaneId]: sort },
          panes: pane?.listing
            ? {
                ...state.panes,
                [targetPaneId]: {
                  ...pane,
                  listing: H.sortListing(pane.listing, sort, state.directorySizes),
                },
              }
            : state.panes,
        };
      });
    },
    setCommandQuery: (paneId, commandQuery) =>
      set((state) => {
        const pane = state.panes[paneId] ?? H.emptyPaneState();
        if (pane.commandQuery === commandQuery) return state;
        return {
          panes: {
            ...state.panes,
            [paneId]: { ...pane, commandQuery },
          },
        };
      }),
    setCommandQueryMode: (paneId, commandQueryMode) =>
      set((state) => {
        const pane = state.panes[paneId] ?? H.emptyPaneState();
        if (pane.commandQueryMode === commandQueryMode) return state;
        return {
          panes: {
            ...state.panes,
            [paneId]: { ...pane, commandQueryMode },
          },
        };
      }),

    toggleHidden: async (paneId) => {
      const targetPaneId = paneId ?? useMultiPanelStore.getState().activePaneId;
      if (!targetPaneId) return;
      const showHidden = !H.showHiddenForPane(get(), targetPaneId);
      set((state) => ({
        showHidden,
        paneShowHidden: { ...state.paneShowHidden, [targetPaneId]: showHidden },
      }));
      const pane = get().panes[targetPaneId];
      if (pane?.listing) await get().loadPane(targetPaneId, pane.listing.path, "replace");
    },
  };
}
