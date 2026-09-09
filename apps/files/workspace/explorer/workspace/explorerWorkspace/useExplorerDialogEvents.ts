import { useEffect, useState, type RefObject } from "react";
import type { CompareDialogSeed } from "../../model/interfaces/workspace/ExplorerCompareDialog";
import { compareSeedForPane } from "../ExplorerContextMenu";
import {
  explorerCompareWithEvent,
  explorerDuplicateFinderEvent,
} from "../ExplorerWorkspaceConstants";

/**
 * Opens the duplicate-finder and compare dialogs from window events.
 *
 * Context menus and commands fire these rather than calling in directly, so the
 * dialogs stay owned by the workspace no matter what triggered them.
 */
export function useExplorerDialogEvents(
  activePaneIdRef: RefObject<string>,
  ownsPane: (paneId: string) => boolean = () => true,
) {
  const [duplicateFinderPaneId, setDuplicateFinderPaneId] = useState<string | null>(null);
  const [compareDialog, setCompareDialog] = useState<CompareDialogSeed | null>(null);

  useEffect(() => {
    const openDuplicateFinder = (event: Event) => {
      const detail = (event as CustomEvent<{ paneId?: string }>).detail;
      const paneId = detail?.paneId || activePaneIdRef.current;
      if (ownsPane(paneId)) setDuplicateFinderPaneId(paneId);
    };
    window.addEventListener(explorerDuplicateFinderEvent, openDuplicateFinder);
    return () => window.removeEventListener(explorerDuplicateFinderEvent, openDuplicateFinder);
  }, [activePaneIdRef, ownsPane]);

  useEffect(() => {
    const openCompareWith = (event: Event) => {
      const detail = (event as CustomEvent<CompareDialogSeed>).detail;
      const seed = detail ?? compareSeedForPane(activePaneIdRef.current);
      if (ownsPane(seed.paneId)) setCompareDialog(seed);
    };
    window.addEventListener(explorerCompareWithEvent, openCompareWith);
    return () => window.removeEventListener(explorerCompareWithEvent, openCompareWith);
  }, [activePaneIdRef, ownsPane]);

  return { duplicateFinderPaneId, setDuplicateFinderPaneId, compareDialog, setCompareDialog };
}
