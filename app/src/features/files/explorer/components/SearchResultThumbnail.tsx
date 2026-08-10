import { explorerGenerateImageThumbnail } from "@/features/files/native";
import type { SearchResult } from "@/native/contracts";
import { safeTauriAssetUrl } from "@/shared/platform/tauri";
import { useEffect, useState } from "react";
import { FileIcon } from "./FileBrowserIcons";

const thumbnailCache = new Map<string, string>();
const failedThumbnails = new Set<string>();
const imageExtensions = new Set([
  "bmp",
  "gif",
  "heic",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "tif",
  "tiff",
  "webp",
]);

export function SearchResultThumbnail(props: {
  result: SearchResult;
  className: string;
  imageClassName: string;
  iconSize?: number;
}) {
  const entry = props.result.entry;
  const cacheKey = `${entry.path}:${entry.modifiedMs ?? entry.remoteModified ?? ""}:${entry.sizeBytes ?? ""}`;
  const [url, setUrl] = useState<string | null>(() => thumbnailCache.get(cacheKey) ?? null);

  useEffect(() => {
    setUrl(thumbnailCache.get(cacheKey) ?? null);
    if (
      !isPreviewableLocalImage(props.result) ||
      failedThumbnails.has(cacheKey) ||
      thumbnailCache.has(cacheKey)
    )
      return;
    let active = true;
    void explorerGenerateImageThumbnail(entry.path, 112, {
      modifiedMs: entry.modifiedMs,
      remoteModified: entry.remoteModified,
      sizeBytes: entry.sizeBytes,
    })
      .then((payload) => {
        const nextUrl = safeTauriAssetUrl(payload.path);
        thumbnailCache.set(cacheKey, nextUrl);
        if (active) setUrl(nextUrl);
      })
      .catch(() => failedThumbnails.add(cacheKey));
    return () => {
      active = false;
    };
  }, [cacheKey, entry.modifiedMs, entry.path, entry.remoteModified, entry.sizeBytes, props.result]);

  return (
    <span className={props.className} aria-hidden="true">
      {url ? (
        <img className={props.imageClassName} src={url} alt="" />
      ) : (
        <FileIcon entry={entry} size={props.iconSize ?? 22} />
      )}
    </span>
  );
}

function isPreviewableLocalImage(result: SearchResult): boolean {
  const entry = result.entry;
  const extension = entry.extension.replace(/^\./, "").toLocaleLowerCase();
  return (
    entry.location.kind === "local" &&
    entry.kind === "file" &&
    ((entry.mimeType ?? "").toLocaleLowerCase().startsWith("image/") ||
      imageExtensions.has(extension))
  );
}
