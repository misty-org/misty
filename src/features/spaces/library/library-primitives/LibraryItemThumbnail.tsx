import { spacesApi } from "../../api/api";
import type { SpaceLibraryItem } from "../../api/dto/entities";
import { Clapperboard, File } from "lucide-react";
import { isVideoProjectFile } from "@/features/files";
import { useCallback, useEffect, useState } from "react";
import {
  cachedContent,
  cachedContentType,
  holdContent,
  libraryViewKey,
  loadContent,
} from "../library-viewer/libraryContentCache";
import { libraryItemThumbnailEligible } from "../libraryThumbnail";
import { LibraryTextPreview } from "./LibraryTextPreview";
import { libraryItemMIME } from "./libraryMediaTypes";
import { TEXT_PREVIEW_MAX_BYTES, textPreviewKind } from "./textPreviewKind";
import { PlaceholderIcon, Surface } from "@misty/ui";

/**
 * A grid thumbnail, preferring the server preview and falling back to the file.
 * Small text files (HTML, Markdown, CSV, code) show a live preview instead.
 *
 * PDFs are rendered through <object> rather than <img>, so the blob's own type
 * decides which element is used rather than the item's declared MIME.
 *
 * What it loads stays in the Library's cache (libraryContentCache.ts): an image's thumbnail is
 * the same preview the viewer shows, so opening it shows at once, and scrolling back to a
 * thumbnail doesn't download it again.
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
  const mimeType = libraryItemMIME(item);
  const size = Number(item.file.intrinsic_metadata.byte_size ?? 0);
  // A video project is the editor's file, not text to preview: it shows as a video project.
  const project = isVideoProjectFile(mimeType, item.file.original_filename);
  const textKind =
    !project && size > 0 && size <= TEXT_PREVIEW_MAX_BYTES
      ? textPreviewKind(mimeType, item.file.original_filename)
      : null;
  const visual =
    !project &&
    !textKind &&
    (libraryItemThumbnailEligible(mimeType, item.file.original_filename) ||
      Number(item.file.intrinsic_metadata.width ?? 0) > 0);
  const loadText = useCallback(
    () => api.libraryContent(spaceId, item.id),
    // A new version of the file reloads its preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, spaceId, item.id, item.version],
  );

  // An image's thumbnail is the viewer's preview, under the viewer's key; anything else's is
  // its own.
  const key = !visual
    ? ""
    : mimeType.startsWith("image/")
      ? libraryViewKey(spaceId, item.id, item.version)
      : `${libraryViewKey(spaceId, item.id, item.version)}:thumbnail`;
  const kindOf = (type: string | undefined): "image" | "pdf" =>
    type === "application/pdf" || (mimeType === "application/pdf" && !type?.startsWith("image/"))
      ? "pdf"
      : "image";
  const [preview, setPreview] = useState<{
    key: string;
    url: string;
    kind: "image" | "pdf";
  } | null>(() => {
    const url = key ? cachedContent(key) : undefined;
    return url ? { key, url, kind: kindOf(cachedContentType(key)) } : null;
  });

  useEffect(() => {
    if (!key) {
      setPreview(null);
      return;
    }
    let current = true;
    let release = () => {};
    void loadContent(key, () =>
      api
        .libraryPreview(spaceId, item.id, item.version)
        .catch(() =>
          mimeType.startsWith("image/") || mimeType === "application/pdf"
            ? api.libraryContent(spaceId, item.id)
            : Promise.reject(new Error("The file reader could not load this item")),
        ),
    )
      .then((url) => {
        if (!current) return;
        release = holdContent(key);
        setPreview({ key, url, kind: kindOf(cachedContentType(key)) });
      })
      .catch(() => current && setPreview(null));
    return () => {
      current = false;
      // The URL stays in the cache for the next time it's shown, so it isn't revoked here.
      release();
    };
    // `kindOf` reads only `mimeType`; the item is read through its id and version, in the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key, mimeType]);

  if (project) return <PlaceholderIcon icon={Clapperboard} />;
  if (textKind)
    return <LibraryTextPreview kind={textKind} name={item.display_name} load={loadText} />;
  const shown = preview?.key === key ? preview : null;
  if (shown?.kind === "image")
    return <img className="size-full object-cover" src={shown.url} alt="" />;
  if (shown?.kind === "pdf")
    return (
      <Surface tone="active" className="pointer-events-none size-full">
        <object
          className="size-full"
          data={shown.url}
          type="application/pdf"
          aria-label={`PDF thumbnail for ${item.display_name}`}
        />
      </Surface>
    );
  return <PlaceholderIcon icon={File} />;
}
