import type { RefObject } from "react";
import type { LibraryEditDefinition } from "@/models/types/features/spaces/types";
import type { LibraryAssetStack, SpaceLibraryItem } from "./types";

export type LibraryItemMetadataPatch = Partial<
  Pick<SpaceLibraryItem, "display_name" | "caption" | "favorite" | "hidden" | "tags">
>;

export interface LibraryItemViewerProps {
  spaceId: string;
  /** The item on screen, or null while the viewer is closed. */
  item: SpaceLibraryItem | null;
  /** The paging set the arrow keys and chevrons walk through. */
  items: SpaceLibraryItem[];
  /** Every loaded item, used to resolve stack members outside the paging set. */
  allItems: SpaceLibraryItem[];
  assetStack: LibraryAssetStack | null;
  reauthenticationToken: string;
  canEdit: boolean;
  canCopy: boolean;
  returnFocusRef: RefObject<HTMLElement | null>;
  onCopyEdit: (definition: LibraryEditDefinition) => void;
  onSetStackCover: (stack: LibraryAssetStack, coverItemID: string) => Promise<void>;
  onSetStackEffect: (
    stack: LibraryAssetStack,
    effect: LibraryAssetStack["effect"],
  ) => Promise<void>;
  onUngroupStack: (stack: LibraryAssetStack) => Promise<void>;
  onClose: () => void;
  onSelect: (itemId: string) => void;
  onUpdate: (
    item: SpaceLibraryItem,
    patch: LibraryItemMetadataPatch,
  ) => Promise<SpaceLibraryItem | null>;
  onReplaceItem: (item: SpaceLibraryItem) => void;
  onRenditionReady: () => void;
  onTrash: (item: SpaceLibraryItem) => Promise<boolean>;
}
