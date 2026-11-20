import type { LibraryItemMetadataPatch } from "./libraryViewerTypes";
import type { SpaceLibraryItem } from "../../api/dto/entities";
import { LibraryMetadataForm } from "./LibraryMetadataForm";
import { LibraryMetadataList } from "./LibraryMetadataList";
import { Surface } from "@misty/ui";

interface LibraryViewerSidebarProps {
  item: SpaceLibraryItem;
  mimeType: string;
  canEdit: boolean;
  onUpdate: (
    item: SpaceLibraryItem,
    patch: LibraryItemMetadataPatch,
  ) => Promise<SpaceLibraryItem | null>;
}

/** The right-hand inspector: the file's name, caption and tags, and what it is. */
export function LibraryViewerSidebar(props: LibraryViewerSidebarProps) {
  return (
    <Surface
      as="aside"
      tone="card"
      className="relative z-10 min-h-0 min-w-0 overflow-y-auto border-l p-5"
    >
      <LibraryMetadataForm item={props.item} canEdit={props.canEdit} onUpdate={props.onUpdate} />
      <LibraryMetadataList item={props.item} mimeType={props.mimeType} />
    </Surface>
  );
}
