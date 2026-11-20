import type { LibraryItemMenuState } from "../components/LibraryItemContextMenu";
import { useEffect, useRef, useState } from "react";

/**
 * Item selection and the context menu.
 *
 * Any change to what is being listed clears the selection, since the selected
 * ids would otherwise refer to items no longer on screen.
 */
export function useLibrarySelection(listIdentity: string) {
  const [selectedItemId, setSelectedItemId] = useState("");
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [itemMenu, setItemMenu] = useState<LibraryItemMenuState | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const libraryViewerTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setSelectedItemIds([]);
  }, [listIdentity]);

  return {
    selectedItemId,
    setSelectedItemId,
    selectedItemIds,
    setSelectedItemIds,
    itemMenu,
    setItemMenu,
    bulkSaving,
    setBulkSaving,
    libraryViewerTriggerRef,
  };
}
