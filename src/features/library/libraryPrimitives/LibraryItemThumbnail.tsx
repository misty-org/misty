import { spacesApi } from "@/api/spaces/api";
import type { SpaceLibraryItem } from "@/api/spaces/dto/entities";
import { File } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { libraryItemThumbnailEligible } from "../libraryThumbnail";
import { LibraryTextPreview } from "./LibraryTextPreview";
import { libraryItemMIME } from "./libraryMediaTypes";
import { TEXT_PREVIEW_MAX_BYTES, textPreviewKind } from "./textPreviewKind";

/**
 * A grid thumbnail, preferring the server preview and falling back to the file.
 * Small text files (HTML, Markdown, CSV, code) show a live preview instead.
 *
 * PDFs are rendered through <object> rather than <img>, so the blob's own type
 * decides which element is used rather than the item's declared MIME.
 */
export function LibraryItemThumbnail({
  spaceId,
  item,
  api = spacesApi,
}: {
  spaceId: string;
  item: SpaceLibraryItem;
  api?: Pick<typeof spacesApi, "libraryPreview" | "libraryContent">;
}) {
  const [preview, setPreview] = useState<{ url: string; kind: "image" | "pdf" } | null>(null);
  const mimeType = libraryItemMIME(item);
  const size = Number(item.file.intrinsic_metadata.byte_size ?? 0);
  const textKind =
    size > 0 && size <= TEXT_PREVIEW_MAX_BYTES
      ? textPreviewKind(mimeType, item.file.original_filename)
      : null;
  const visual =
    !textKind &&
    (libraryItemThumbnailEligible(mimeType, item.file.original_filename) ||
      Number(item.file.intrinsic_metadata.width ?? 0) > 0);
  const loadText = useCallback(
    () => api.libraryContent(spaceId, item.id),
    // A new version of the file reloads its preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, spaceId, item.id, item.version],
  );

  useEffect(() => {
    if (!visual) {
      setPreview(null);
      return;
    }
    let current = true;
    let objectUrl = "";
    void api
      .libraryPreview(spaceId, item.id, item.version)
      .catch(() =>
        mimeType.startsWith("image/") || mimeType === "application/pdf"
          ? api.libraryContent(spaceId, item.id)
          : Promise.reject(new Error("The file reader could not load this item")),
      )
      .then((blob) => {
        if (!current) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview({
          url: objectUrl,
          kind:
            blob.type === "application/pdf" ||
            (mimeType === "application/pdf" && !blob.type.startsWith("image/"))
              ? "pdf"
              : "image",
        });
      })
      .catch(() => setPreview(null));
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, item.id, item.version, mimeType, spaceId, visual]);

  if (textKind)
    return <LibraryTextPreview kind={textKind} name={item.display_name} load={loadText} />;
  if (preview?.kind === "image")
    return <img className="size-full object-cover" src={preview.url} alt="" />;
  if (preview?.kind === "pdf")
    return (
      <object
        className="pointer-events-none size-full bg-charcoal-active"
        data={preview.url}
        type="application/pdf"
        aria-label={`PDF thumbnail for ${item.display_name}`}
      />
    );
  return <File size={30} />;
}
