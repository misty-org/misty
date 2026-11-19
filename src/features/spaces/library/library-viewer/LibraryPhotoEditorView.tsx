import { ImageAgentPanel, useAiSurfaceAdapter, useMediaAgent } from "@/features/agents";
import {
  PhotoEditor,
  applyImageChanges,
  applyLibraryEditDefinition,
  canvasToBlob,
  defaultImageEdit,
  imageDocParts,
  loadPhoto,
  readImageEdit,
  renderEdit,
  writeImageEdit,
  type ImageEdit,
} from "@/features/files";
import type { AiArtifact, AiSurfaceAdapter } from "@/features/agents";
import { spacesApi } from "../../api/api";
import type { SpaceLibraryItem } from "../../api/dto/entities";
import { editedImageFilename, editedImageMimeType } from "./libraryMediaKind";
import { useMemo, useRef } from "react";
import { useLibraryImageCollaboration } from "./useLibraryImageCollaboration";

/**
 * The image path: Misty's photo editor renders in the browser and the result is uploaded.
 *
 * Everyone with the image open edits it together, live, with their agents: the edit is shared
 * in the image's room until someone saves it. It shows the item's preview and saves from its
 * full-size file. "Save" replaces the item in place, "Save as copy" and "Save as" upload a new
 * item, each in the format picked in the editor. No server-side edit rendering is involved.
 * Errors propagate so the editor surfaces them itself.
 *
 * The AI pane's image edits are the same checked change an agent sends `image.edit`
 * (`applyImageChanges`): light and color, a filter, a crop or a crop to a shape, a turn, a
 * mirror, a size and marks.
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
  onPrevious,
  onNext,
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
  /** The image before and after this one in the Library, when there are any. */
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  // Named for the format it was saved in, which the editor may have changed.
  const filename = (rendered: Blob) =>
    editedImageFilename(item.display_name, rendered.type || mimeType);
  // The parent hands new callbacks on every render. The adapter calls the latest ones through a
  // ref instead of depending on them: a new adapter is pushed into the AI pane host, which
  // re-renders the Library, which hands new callbacks again ("Maximum update depth exceeded").
  const callbacks = useRef({ onReplaceItem, onRenditionReady });
  callbacks.current = { onReplaceItem, onRenditionReady };
  const live = useLibraryImageCollaboration(spaceId, item.id, item.version, canEdit);
  // The adapter reaches the live edit through a ref, for the same reason as the callbacks.
  const liveDoc = useRef<ReturnType<typeof imageDocParts> | null>(null);
  liveDoc.current = live.state === "live" ? imageDocParts(live.session.doc) : null;
  const metadataSize = {
    width: Number(item.file.intrinsic_metadata.width ?? 0),
    height: Number(item.file.intrinsic_metadata.height ?? 0),
  };
  const naturalSize = metadataSize.width > 0 && metadataSize.height > 0 ? metadataSize : undefined;
  const aiAdapter = useMemo<AiSurfaceAdapter>(() => {
    const metadata = JSON.stringify({
      asset_id: item.id,
      display_name: item.display_name,
      mime_type: mimeType,
      version: item.version,
      caption: item.caption,
      tags: item.tags,
      favorite: item.favorite,
      intrinsic_metadata: item.file.intrinsic_metadata,
      editable: canEdit,
    }).slice(0, 32 << 10);
    const natural = {
      width: Number(item.file.intrinsic_metadata.width ?? 0),
      height: Number(item.file.intrinsic_metadata.height ?? 0),
    };
    /**
     * The proposal as a change to an edit, or null when it isn't for this version of this image or
     * doesn't check out. `changes` is `image.edit`'s change; an older proposal's `edit_definition`
     * (the Library's adjustments) still lands the way it used to.
     */
    const applicableEdit = (artifact: AiArtifact): ((edit: ImageEdit) => ImageEdit) | null => {
      if (
        artifact.kind !== "image_edit" ||
        !canEdit ||
        artifact.target?.id !== item.id ||
        artifact.target?.spaceId !== spaceId ||
        Number(artifact.baseRevision) !== item.version
      )
        return null;
      const operations = artifact.operations as {
        asset_id?: string;
        output?: string;
        preserve_original?: boolean;
        changes?: unknown;
        edit_definition?: unknown;
      };
      if (
        operations.asset_id !== item.id ||
        operations.output !== "new_version" ||
        operations.preserve_original !== true
      )
        return null;
      const plain = (value: unknown): value is Record<string, unknown> =>
        Boolean(value) && typeof value === "object" && !Array.isArray(value);
      if (plain(operations.changes)) {
        const changes = operations.changes;
        const apply = (edit: ImageEdit) =>
          applyImageChanges(edit, changes, { author: "Agent", natural });
        try {
          // Checked once up front, so a proposal that can't land is never offered to apply.
          apply(defaultImageEdit);
        } catch {
          return null;
        }
        return apply;
      }
      if (plain(operations.edit_definition)) {
        const definition = operations.edit_definition;
        return (edit: ImageEdit) => applyLibraryEditDefinition(edit, definition);
      }
      return null;
    };
    return {
      surfaceId: "photo-editor",
      label: item.display_name,
      getContext: () => [
        {
          kind: "library.item",
          id: item.id,
          title: item.display_name,
          privacy: "shared",
          spaceId,
          revision: item.version,
          href: `/spaces/${encodeURIComponent(spaceId)}/media?item=${encodeURIComponent(item.id)}`,
          metadata: { mime_type: mimeType, editable: canEdit },
        },
      ],
      getSelection: () => ({
        kind: "objects",
        content: metadata,
        object: { kind: "library.item", id: item.id, spaceId, revision: item.version },
        anchors: { editor: "photo", source_version: item.version },
        contentHash: photoEditorAiHash(metadata),
      }),
      getSuggestedActions: () => [
        {
          id: "photo-edit-ideas",
          label: "Suggest edits",
          prompt:
            "Suggest a concise, ordered set of non-destructive edits for this image based on its visible metadata " +
            "and the user's goal. Do not claim to see pixels that were not attached.",
        },
        {
          id: "photo-metadata",
          label: "Improve metadata",
          prompt:
            "Suggest a useful caption, alt text, and tags for this image. Clearly separate facts grounded in " +
            "metadata from guesses that require visual inspection.",
        },
        {
          id: "photo-new-version",
          label: "Plan AI edit",
          prompt:
            "Propose a non-destructive edit of this image as a new version: light and color, a " +
            "filter, a crop, a turn, a size or marks. Preserve the original and make the " +
            "instruction specific and reviewable.",
          requestedArtifactKind: "image_edit",
        },
      ],
      canApply: (artifact) => Boolean(applicableEdit(artifact)),
      applyArtifact: async (artifact) => {
        const apply = applicableEdit(artifact);
        if (!apply)
          throw new Error("The image version changed. Ask your agent to regenerate this edit.");
        // With the editor open the edit lands in it, live for everyone, as one step undo takes back.
        const parts = liveDoc.current;
        if (parts) {
          writeImageEdit(parts, apply(readImageEdit(parts)));
          return;
        }
        // Without the live edit, it is drawn here from the original and saved as a new version.
        const original = await loadPhoto(await spacesApi.libraryContent(spaceId, item.id));
        const rendered = await canvasToBlob(
          await renderEdit(original, apply(defaultImageEdit)),
          editedImageMimeType(mimeType),
        );
        const result = await spacesApi.replaceLibraryItemContent(
          spaceId,
          item,
          rendered,
          editedImageFilename(item.display_name, rendered.type || mimeType),
        );
        if (result.item) callbacks.current.onReplaceItem(result.item);
        callbacks.current.onRenditionReady();
      },
    };
  }, [canEdit, item, mimeType, spaceId]);
  useAiSurfaceAdapter(aiAdapter);
  // The Agent tab, where the person's agent can work on this image (its home Space is here).
  const agent = useMediaAgent(spaceId);
  const agentPanel = useMemo(
    () =>
      canEdit && agent ? (
        <ImageAgentPanel spaceId={spaceId} itemId={item.id} name={item.display_name} />
      ) : undefined,
    [agent, canEdit, item.display_name, item.id, spaceId],
  );

  return (
    <>
      <PhotoEditor
        sourceKey={`${item.id}:${item.version}`}
        name={item.display_name}
        url={contentUrl}
        indexLabel={indexLabel}
        tags={item.tags}
        outputMimeType={editedImageMimeType(mimeType)}
        naturalSize={naturalSize}
        collaboration={live.state === "live" ? live.collaboration : null}
        agentPanel={agentPanel}
        loading={contentLoading}
        error={contentError || undefined}
        // The image shows as soon as it's loaded; editing waits for the live edit, so nothing
        // done in the first moment is made apart from everyone else's.
        readonly={!canEdit || live.state === "opening"}
        loadOriginal={() => spacesApi.libraryContent(spaceId, item.id)}
        onClose={onClose}
        onCancel={onClose}
        onPrevious={onPrevious}
        onNext={onNext}
        onSave={async (rendered: Blob) => {
          const result = await spacesApi.replaceLibraryItemContent(
            spaceId,
            item,
            rendered,
            filename(rendered),
          );
          if (result.item) onReplaceItem(result.item);
          onRenditionReady();
          // The shared edit starts again from the version just saved.
          return String(result.item?.version ?? item.version + 1);
        }}
        onSaveAsCopy={async (rendered: Blob, name?: string) => {
          await spacesApi.uploadLibraryBlob(
            spaceId,
            rendered,
            name ?? filename(rendered),
            "library",
          );
          onRenditionReady();
        }}
      />
    </>
  );
}

function photoEditorAiHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}
