import { PhotoEditor } from "@/features/editor";
import {
  useAiSurfaceAdapter,
  type AiArtifact,
  type AiSurfaceAdapter,
} from "@/features/ai-surface/AiPaneHost";
import { spacesApi } from "@/api/spaces/api";
import type { SpaceLibraryItem } from "@/api/spaces/dto/interfaces/types";
import { editedImageFilename, editedImageMimeType } from "./libraryMediaKind";
import { defaultLibraryEdit } from "../SpaceLibraryViewerUtils";
import type { LibraryEditDefinition } from "@/api/spaces/dto/types/types";
import { useMemo } from "react";

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
    const applicableEdit = (artifact: AiArtifact) => {
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
        edit_definition?: Record<string, unknown>;
      };
      if (
        operations.asset_id !== item.id ||
        operations.output !== "new_version" ||
        operations.preserve_original !== true
      )
        return null;
      return normalizeAiImageEdit(operations.edit_definition);
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
          href: `/spaces/${encodeURIComponent(spaceId)}/library?item=${encodeURIComponent(item.id)}`,
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
            "Propose a non-destructive AI image edit as a new version. Preserve the original and make the instruction specific and reviewable.",
          requestedArtifactKind: "image_edit",
        },
      ],
      canApply: (artifact) => Boolean(applicableEdit(artifact)),
      applyArtifact: async (artifact) => {
        const definition = applicableEdit(artifact);
        if (!definition)
          throw new Error("The image version changed. Ask Misty to regenerate this edit.");
        const result = await spacesApi.createEditVersion(spaceId, item, definition);
        if (!result.edit || !result.item)
          throw new Error("Misty could not create the image version.");
        await spacesApi.renderEditVersion(spaceId, item.id, result.edit.id);
        onReplaceItem(result.item);
        onRenditionReady();
      },
    };
  }, [canEdit, item, mimeType, onRenditionReady, onReplaceItem, spaceId]);
  useAiSurfaceAdapter(aiAdapter);

  return (
    <>
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
    </>
  );
}

function normalizeAiImageEdit(value?: Record<string, unknown>): LibraryEditDefinition | null {
  if (!value) return null;
  const allowed = new Set([
    "auto_enhance",
    "filter",
    "brightness",
    "contrast",
    "saturation",
    "grayscale",
    "exposure",
    "brilliance",
    "highlights",
    "shadows",
    "black_point",
    "vibrance",
    "warmth",
    "tint",
    "sharpness",
    "definition",
    "noise_reduction",
    "vignette",
    "straighten",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;
  const filters = new Set(["", "vivid", "dramatic", "warm", "cool", "mono", "noir"]);
  if (value.auto_enhance !== undefined && typeof value.auto_enhance !== "boolean") return null;
  if (
    value.filter !== undefined &&
    (typeof value.filter !== "string" || !filters.has(value.filter))
  )
    return null;
  const ranges: Record<string, [number, number]> = {
    brightness: [0, 3],
    contrast: [0, 3],
    saturation: [0, 3],
    grayscale: [0, 1],
    exposure: [-2, 2],
    brilliance: [-1, 1],
    highlights: [-1, 1],
    shadows: [-1, 1],
    black_point: [-1, 1],
    vibrance: [-1, 1],
    warmth: [-1, 1],
    tint: [-1, 1],
    sharpness: [0, 2],
    definition: [0, 2],
    noise_reduction: [0, 1],
    vignette: [0, 1],
    straighten: [-45, 45],
  };
  for (const [key, [minimum, maximum]] of Object.entries(ranges)) {
    const candidate = value[key];
    if (
      candidate !== undefined &&
      (typeof candidate !== "number" ||
        !Number.isFinite(candidate) ||
        candidate < minimum ||
        candidate > maximum)
    )
      return null;
  }
  const definition = { ...defaultLibraryEdit(), ...value } as LibraryEditDefinition;
  return JSON.stringify(definition) === JSON.stringify(defaultLibraryEdit()) ? null : definition;
}

function photoEditorAiHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}
