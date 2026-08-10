import type { LibraryItemMetadataPatch } from "@/api/spaces/dto/interfaces/SpaceLibraryViewer";
import type { LibraryEditVersion, SpaceLibraryItem } from "@/api/spaces/dto/interfaces/types";
import type { LibraryEditDefinition } from "@/api/spaces/dto/types/types";
import type { Dispatch, SetStateAction } from "react";
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
    <aside className="relative z-10 min-h-0 min-w-0 overflow-y-auto border-l border-charcoal-border/60 bg-charcoal-card p-5">
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
