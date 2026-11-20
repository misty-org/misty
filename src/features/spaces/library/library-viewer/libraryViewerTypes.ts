import type { RefObject } from "react";
import type { SpaceLibraryItem } from "../../api/dto/entities";

export type LibraryItemMetadataPatch = Partial<
  Pick<SpaceLibraryItem, "display_name" | "caption" | "favorite" | "hidden" | "tags">
>;

export interface LibraryItemViewerProps {
  spaceId: string;
  /** The item on screen, or null while the viewer is closed. */
  item: SpaceLibraryItem | null;
  /** The paging set the arrow keys and chevrons walk through. */
  items: SpaceLibraryItem[];
  canEdit: boolean;
  canCopy: boolean;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSelect: (itemId: string) => void;
  onUpdate: (
    item: SpaceLibraryItem,
    patch: LibraryItemMetadataPatch,
  ) => Promise<SpaceLibraryItem | null>;
  onTrash: (item: SpaceLibraryItem) => Promise<boolean>;
}
