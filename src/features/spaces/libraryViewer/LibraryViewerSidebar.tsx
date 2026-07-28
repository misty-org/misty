import type { Dispatch, SetStateAction } from "react";
import type { LibraryEditDefinition } from "@/models/types/features/spaces/types";
import type {
  LibraryEditVersion,
  SpaceLibraryItem,
} from "@/models/interfaces/features/spaces/types";
import type { LibraryItemMetadataPatch } from "@/models/interfaces/features/spaces/SpaceLibraryViewer";
import { LibraryEditPanel } from "./LibraryEditPanel";
import { LibraryMetadataForm } from "./LibraryMetadataForm";
import { LibraryMetadataList } from "./LibraryMetadataList";
import { LibraryVersionList } from "./LibraryVersionList";

export interface LibraryViewerSidebarProps {
  item: SpaceLibraryItem;
  mimeType: string;
  canEdit: boolean;
  isImage: boolean;
  isVideo: boolean;
  durationSeconds: number;
  editing: boolean;
  editDraft: LibraryEditDefinition;
  setEditDraft: Dispatch<SetStateAction<LibraryEditDefinition>>;
  editSaving: boolean;
  editError: string;
  editingAvailable: boolean;
  editVersions: LibraryEditVersion[];
  activeEdit: LibraryEditVersion | null;
  onUpdate: (
    item: SpaceLibraryItem,
    patch: LibraryItemMetadataPatch,
  ) => Promise<SpaceLibraryItem | null>;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onSelectVersion: (editID?: string) => void;
  onRenderVersion: (editID: string) => void;
  onDeleteVersion: (editID: string) => void;
}

/** The right-hand inspector: edit controls, metadata and version history. */
export function LibraryViewerSidebar(props: LibraryViewerSidebarProps) {
  return (
    <aside className="relative z-10 min-h-0 min-w-0 overflow-y-auto border-l border-border/60 bg-card p-5">
      {props.editing ? (
        <LibraryEditPanel
          draft={props.editDraft}
          onChange={props.setEditDraft}
          isImage={props.isImage}
          isVideo={props.isVideo}
          durationSeconds={props.durationSeconds}
          editSaving={props.editSaving}
          editError={props.editError}
          onCancel={props.onCancelEdit}
          onSave={props.onSaveEdit}
        />
      ) : null}

      <LibraryMetadataForm item={props.item} canEdit={props.canEdit} onUpdate={props.onUpdate} />
      <LibraryMetadataList item={props.item} mimeType={props.mimeType} />

      {props.editingAvailable ? (
        <LibraryVersionList
          versions={props.editVersions}
          activeEdit={props.activeEdit}
          canEdit={props.canEdit}
          editSaving={props.editSaving}
          error={props.editing ? "" : props.editError}
          onSelect={props.onSelectVersion}
          onRender={props.onRenderVersion}
          onDelete={props.onDeleteVersion}
        />
      ) : null}
    </aside>
  );
}
