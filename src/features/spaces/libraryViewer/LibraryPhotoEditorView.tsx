import { PhotoEditor } from "@/features/editor/PhotoEditor";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type { SpaceLibraryItem } from "@/models/interfaces/features/spaces/types";
import { editedImageFilename, editedImageMimeType } from "./libraryMediaKind";

/**
 * The image path: filerobot renders in the browser and we upload the result.
 *
 * "Save" replaces the original in place, "Save as a copy" uploads a new item.
 * No server-side edit rendering is involved. Errors propagate so the editor
 * surfaces them itself.
 */
export function LibraryPhotoEditorView({
  spaceId,
  item,
  mimeType,
  contentUrl,
  contentLoading,
  contentError,
  indexLabel,
  canEdit,
  onClose,
  onReplaceItem,
  onRenditionReady,
}: {
  spaceId: string;
  item: SpaceLibraryItem;
  mimeType: string;
  contentUrl: string;
  contentLoading: boolean;
  contentError: string;
  indexLabel: string;
  canEdit: boolean;
  onClose: () => void;
  onReplaceItem: (item: SpaceLibraryItem) => void;
  onRenditionReady: () => void;
}) {
  const filename = () => editedImageFilename(item.display_name, mimeType);

  return (
    <PhotoEditor
      sourceKey={`${item.id}:${item.version}`}
      name={item.display_name}
      url={contentUrl}
      indexLabel={indexLabel}
      tags={item.tags}
      outputMimeType={editedImageMimeType(mimeType)}
      loading={contentLoading}
      error={contentError || undefined}
      readonly={!canEdit}
      onClose={onClose}
      onCancel={onClose}
      onSave={async (rendered: Blob) => {
        const result = await spacesApi.replaceLibraryItemContent(
          spaceId,
          item,
          rendered,
          filename(),
        );
        if (result.item) onReplaceItem(result.item);
        onRenditionReady();
      }}
      onSaveAsCopy={async (rendered: Blob) => {
        await spacesApi.uploadLibraryBlob(spaceId, rendered, filename(), "library");
        onRenditionReady();
      }}
    />
  );
}
