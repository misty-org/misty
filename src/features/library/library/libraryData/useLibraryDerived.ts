import type { SpaceLibraryItem } from "@/api/spaces/dto/entities";
import { useMemo } from "react";

/** Everything the Library reads but never stores. */
export function useLibraryDerived(options: {
  visibleItems: SpaceLibraryItem[];
  selectedItemIds: string[];
}) {
  const { visibleItems, selectedItemIds } = options;
  const selectedItems = useMemo(
    () => visibleItems.filter((item) => selectedItemIds.includes(item.id)),
    [visibleItems, selectedItemIds],
  );
  return { displayItems: visibleItems, selectedItems };
}
