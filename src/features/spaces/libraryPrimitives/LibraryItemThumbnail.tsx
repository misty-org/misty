import { useEffect, useState } from "react";
import { File } from "lucide-react";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type { SpaceLibraryItem } from "@/models/interfaces/features/spaces/types";
import { libraryItemThumbnailEligible } from "../libraryThumbnail";
import { libraryItemMIME } from "./libraryMediaTypes";

/**
 * A grid thumbnail, preferring the server preview and falling back to the file.
 *
 * PDFs are rendered through <object> rather than <img>, so the blob's own type
 * decides which element is used rather than the item's declared MIME.
 */
export function LibraryItemThumbnail({
  spaceId,
  item,
  reauthenticationToken = "",
}: {
  spaceId: string;
  item: SpaceLibraryItem;
  reauthenticationToken?: string;
}) {
  const [preview, setPreview] = useState<{ url: string; kind: "image" | "pdf" } | null>(null);
  const mimeType = libraryItemMIME(item);
  const visual =
    libraryItemThumbnailEligible(mimeType, item.file.original_filename) ||
    Number(item.file.intrinsic_metadata.width ?? 0) > 0;

  useEffect(() => {
    if (!visual) {
      setPreview(null);
      return;
    }
    let current = true;
    let objectUrl = "";
    void spacesApi
      .libraryPreview(spaceId, item.id, reauthenticationToken, item.version)
      .catch(() =>
        mimeType.startsWith("image/") || mimeType === "application/pdf"
          ? spacesApi.libraryContent(spaceId, item.id, reauthenticationToken)
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
  }, [item.id, item.version, mimeType, reauthenticationToken, spaceId, visual]);

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
