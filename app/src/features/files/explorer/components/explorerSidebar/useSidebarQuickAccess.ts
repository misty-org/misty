import { useMemo } from "react";
import type { ExplorerSidebarProps } from "../../model/interfaces/components/ExplorerSidebar";
import type { QuickAccessMenuItem } from "../../model/types/components/ExplorerSidebarSupport";
import {
  addHiddenQuickAccessPath,
  dedupePinnedPathsForQuickAccess,
  normalizeSidebarPath,
  quickAccessPathHidden,
} from "../ExplorerSidebarSupport";
import { buildQuickAccessItems } from "./quickAccessItems";

/**
 * The Quick access list, minus anything the user has hidden.
 *
 * Built-in rows can only be hidden (they come back from the platform); pinned
 * rows are removed outright through the parent's unpin callback.
 */
export function useSidebarQuickAccess(options: {
  sidebar: ExplorerSidebarProps;
  hiddenQuickAccessPaths: string[];
  setHiddenQuickAccessPaths: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  const { sidebar, hiddenQuickAccessPaths, setHiddenQuickAccessPaths } = options;

  const quickAccess = useMemo(
    () =>
      buildQuickAccessItems({
        androidLocal: sidebar.androidLocal,
        androidAllFilesAccess: sidebar.androidAllFilesAccess,
        androidGrantedFolders: sidebar.androidGrantedFolders,
        homePath: sidebar.homePath,
      }),
    [
      sidebar.androidAllFilesAccess,
      sidebar.androidGrantedFolders,
      sidebar.androidLocal,
      sidebar.homePath,
    ],
  );
  const visiblePinnedPaths = useMemo(
    () =>
      dedupePinnedPathsForQuickAccess(
        sidebar.pinnedPaths,
        quickAccess
          .filter((item) => !quickAccessPathHidden(item.path, hiddenQuickAccessPaths))
          .map((item) => item.path),
      ),
    [hiddenQuickAccessPaths, sidebar.pinnedPaths, quickAccess],
  );
  const visibleQuickAccess = useMemo(
    () => quickAccess.filter((item) => !quickAccessPathHidden(item.path, hiddenQuickAccessPaths)),
    [hiddenQuickAccessPaths, quickAccess],
  );

  const removeQuickAccessItem = (item: QuickAccessMenuItem) => {
    if (item.kind === "builtIn") {
      setHiddenQuickAccessPaths((paths) => addHiddenQuickAccessPath(paths, item.path));
    } else {
      sidebar.onUnpinPinnedPath(item.path);
    }
  };

  const resetQuickAccessDefaults = () => {
    setHiddenQuickAccessPaths([]);
  };

  const toggleQuickAccessDefault = (path: string) => {
    setHiddenQuickAccessPaths((paths) =>
      quickAccessPathHidden(path, paths)
        ? paths.filter(
            (candidate) => normalizeSidebarPath(candidate) !== normalizeSidebarPath(path),
          )
        : addHiddenQuickAccessPath(paths, path),
    );
  };

  /** True when this built-in row has been hidden by the user. */
  const isQuickAccessPathHidden = (path: string) =>
    quickAccessPathHidden(path, hiddenQuickAccessPaths);

  const hideQuickAccessPath = (path: string) =>
    setHiddenQuickAccessPaths((paths) => addHiddenQuickAccessPath(paths, path));

  return {
    quickAccess,
    isQuickAccessPathHidden,
    hideQuickAccessPath,
    visiblePinnedPaths,
    visibleQuickAccess,
    removeQuickAccessItem,
    resetQuickAccessDefaults,
    toggleQuickAccessDefault,
  };
}
