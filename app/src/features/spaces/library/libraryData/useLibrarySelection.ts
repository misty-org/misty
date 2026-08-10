import type { LibraryItemMenuState } from "@/api/spaces/dto/interfaces/components/LibraryItemContextMenu";
import type { LibraryEditDefinition } from "@/api/spaces/dto/types/types";
import { useEffect, useRef, useState } from "react";

/**
 * Item selection, the context menu, and the copied-edit clipboard.
 *
 * Any change to what is being listed clears the selection, since the selected
 * ids would otherwise refer to items no longer on screen.
 */
export function useLibrarySelection(listIdentity: string) {
  const [selectedItemId, setSelectedItemId] = useState("");
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [itemMenu, setItemMenu] = useState<LibraryItemMenuState | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [copiedEditDefinition, setCopiedEditDefinition] = useState<LibraryEditDefinition | null>(
    null,
  );
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
    copiedEditDefinition,
    setCopiedEditDefinition,
    libraryViewerTriggerRef,
  };
}
