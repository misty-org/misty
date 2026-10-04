import { isRetiredCloudLocation } from "@/shared/lib/fileLocations";
import { useMemo } from "react";
import type { ExplorerSidebarProps } from "../../model/interfaces/components/ExplorerSidebar";
import type { QuickAccessItem } from "../../model/types/components/ExplorerSidebar";
import {
  type QuickAccessMenuItem,
  addHiddenQuickAccessPath,
  dedupePinnedPathsForQuickAccess,
  normalizeSidebarPath,
  orderQuickAccessRows,
  pinnedPathLabel,
  quickAccessPathHidden,
} from "@/features/file-ui";
import { reorderIds } from "@/shared/hooks/usePointerReorder";
import { buildQuickAccessItems } from "./quickAccessItems";

/** One Quick access row: a platform folder or a user pin, in display order. */
export type QuickAccessRow =
  | { kind: "builtIn"; path: string; label: string; icon: QuickAccessItem["icon"] }
  | { kind: "pinned"; path: string; label: string };

/**
 * The Quick access list, minus anything the user has hidden.
 *
 * Built-in rows can only be hidden (they come back from the platform); pinned
 * rows are removed outright through the parent's unpin callback.
 */
export function useSidebarQuickAccess(options: {
  sidebar: ExplorerSidebarProps;
  items?: QuickAccessItem[];
  hiddenQuickAccessPaths: string[];
  setHiddenQuickAccessPaths: React.Dispatch<React.SetStateAction<string[]>>;
  quickAccessOrder: string[];
  setQuickAccessOrder: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  const {
    sidebar,
    hiddenQuickAccessPaths,
    setHiddenQuickAccessPaths,
    quickAccessOrder,
    setQuickAccessOrder,
  } = options;
  const quickAccess = useMemo(
    () =>
      options.items ??
      buildQuickAccessItems({
        homePath: sidebar.homePath,
      }),
    [options.items, sidebar.homePath],
  );
  const visiblePinnedPaths = useMemo(
    () =>
      dedupePinnedPathsForQuickAccess(
        sidebar.pinnedPaths.filter((path) => !isRetiredCloudLocation(path, sidebar.mountRoot)),
        quickAccess
          .filter((item) => !quickAccessPathHidden(item.path, hiddenQuickAccessPaths))
          .map((item) => item.path),
      ),
    [hiddenQuickAccessPaths, sidebar.pinnedPaths, sidebar.mountRoot, quickAccess],
  );
  const visibleQuickAccess = useMemo(
    () => quickAccess.filter((item) => !quickAccessPathHidden(item.path, hiddenQuickAccessPaths)),
    [hiddenQuickAccessPaths, quickAccess],
  );
  const rows = useMemo<QuickAccessRow[]>(
    () =>
      orderQuickAccessRows(
        [
          ...visibleQuickAccess.map((item) => ({ kind: "builtIn" as const, ...item })),
          ...visiblePinnedPaths.map((path) => ({
            kind: "pinned" as const,
            path,
            label: pinnedPathLabel(path),
          })),
        ],
        quickAccessOrder,
      ),
    [quickAccessOrder, visiblePinnedPaths, visibleQuickAccess],
  );
  /** Moves one row before or after another and remembers the whole visible order. */
  const moveQuickAccessRow = (path: string, target: string, after: boolean) =>
    setQuickAccessOrder(
      reorderIds(
        rows.map((row) => row.path),
        [path],
        target,
        after,
      ),
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
    rows,
    moveQuickAccessRow,
    removeQuickAccessItem,
    resetQuickAccessDefaults,
    toggleQuickAccessDefault,
  };
}
