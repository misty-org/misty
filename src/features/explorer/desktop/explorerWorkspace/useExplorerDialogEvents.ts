import { useEffect, useState, type RefObject } from "react";
import type { CompareDialogSeed } from "@/models/interfaces/features/explorer/desktop/ExplorerCompareDialog";
import {
  explorerCompareWithEvent,
  explorerDuplicateFinderEvent,
} from "../ExplorerWorkspaceConstants";
import { compareSeedForPane } from "../ExplorerContextMenu";

/**
 * Opens the duplicate-finder and compare dialogs from window events.
 *
 * Context menus and commands fire these rather than calling in directly, so the
 * dialogs stay owned by the workspace no matter what triggered them.
 */
export function useExplorerDialogEvents(activePaneIdRef: RefObject<string>) {
  const [duplicateFinderPaneId, setDuplicateFinderPaneId] = useState<string | null>(null);
  const [compareDialog, setCompareDialog] = useState<CompareDialogSeed | null>(null);

  useEffect(() => {
    const openDuplicateFinder = (event: Event) => {
      const detail = (event as CustomEvent<{ paneId?: string }>).detail;
      setDuplicateFinderPaneId(detail?.paneId || activePaneIdRef.current);
    };
    window.addEventListener(explorerDuplicateFinderEvent, openDuplicateFinder);
    return () => window.removeEventListener(explorerDuplicateFinderEvent, openDuplicateFinder);
  }, []);

  useEffect(() => {
    const openCompareWith = (event: Event) => {
      const detail = (event as CustomEvent<CompareDialogSeed>).detail;
      setCompareDialog(detail ?? compareSeedForPane(activePaneIdRef.current));
    };
    window.addEventListener(explorerCompareWithEvent, openCompareWith);
    return () => window.removeEventListener(explorerCompareWithEvent, openCompareWith);
  }, []);

  return { duplicateFinderPaneId, setDuplicateFinderPaneId, compareDialog, setCompareDialog };
}
