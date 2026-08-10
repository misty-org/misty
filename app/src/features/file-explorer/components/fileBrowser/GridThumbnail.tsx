import type { FileEntry } from "@/services/misty/model/misty-api";
import { useEffect, useState } from "react";
import { FileIcon } from "../FileBrowserIcons";
import { fileBrowserStyles } from "../FileBrowserStyles";
import { GRID_THUMBNAIL_MAX_DIMENSION } from "./fileTableConfig";
import { gridThumbnailSupported, requestGridThumbnail } from "./gridThumbnails";

/** A grid tile's image, falling back to the file-type icon. */
export function GridThumbnail({
  entry,
  enabled,
  iconSize,
}: {
  entry: FileEntry;
  enabled: boolean;
  iconSize: number;
}) {
  const thumbnailUrl = useGridThumbnailUrl(entry, enabled);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [thumbnailUrl, entry.id, entry.path]);

  if (thumbnailUrl && !failed)
    return (
      <span className={fileBrowserStyles.gridThumb}>
        <img
          className={fileBrowserStyles.gridThumbImage}
          src={thumbnailUrl}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      </span>
    );

  return (
    <span className={fileBrowserStyles.gridThumbIcon}>
      <FileIcon entry={entry} size={iconSize} />
    </span>
  );
}

function useGridThumbnailUrl(entry: FileEntry, enabled: boolean): string | null {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  useEffect(() => {
    setThumbnailUrl(null);
    if (!enabled || !gridThumbnailSupported(entry)) return () => undefined;
    return requestGridThumbnail(entry, GRID_THUMBNAIL_MAX_DIMENSION, setThumbnailUrl);
  }, [enabled, entry]);

  return thumbnailUrl;
}
