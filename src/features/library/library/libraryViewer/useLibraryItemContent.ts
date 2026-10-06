import { libraryApi as spacesApi } from "../LibraryRuntime";
import type { SpaceLibraryItem } from "@/api/spaces/dto/entities";
import { useEffect, useState } from "react";

export interface LibraryItemContent {
  contentUrl: string;
  contentLoading: boolean;
  contentError: string;
}

/**
 * Loads the bytes for the item on screen, as an object URL.
 *
 * Editing needs the untouched original; plain viewing prefers the cheaper
 * server-side preview for images and falls back to the file itself.
 */
export function useLibraryItemContent(options: {
  spaceId: string;
  item: SpaceLibraryItem | null;
  editing: boolean;
  itemIsImage: boolean;
  renditionState: string | undefined;
}): LibraryItemContent {
  const { spaceId, item, editing, itemIsImage, renditionState } = options;
  const [contentUrl, setContentUrl] = useState("");
  const [contentError, setContentError] = useState("");
  const [contentLoading, setContentLoading] = useState(false);

  useEffect(() => {
    if (!item) {
      setContentUrl("");
      setContentError("");
      return;
    }
    let current = true;
    let objectUrl = "";
    setContentLoading(true);
    setContentError("");

    const request = itemIsImage
      ? editing
        ? spacesApi
            .libraryOriginalPreview(spaceId, item.id, item.version)
            .catch(() => spacesApi.libraryOriginalContent(spaceId, item.id))
        : spacesApi
            .libraryPreview(spaceId, item.id, item.version)
            .catch(() => spacesApi.libraryContent(spaceId, item.id))
      : editing
        ? spacesApi.libraryOriginalContent(spaceId, item.id)
        : spacesApi.libraryContent(spaceId, item.id);

    void request
      .then((blob) => {
        if (!current) return;
        objectUrl = URL.createObjectURL(blob);
        setContentUrl(objectUrl);
      })
      .catch(
        (error: unknown) =>
          current &&
          setContentError(
            error instanceof Error ? error.message : "The file reader could not load this item.",
          ),
      )
      .finally(() => current && setContentLoading(false));

    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [editing, item, itemIsImage, renditionState, spaceId]);

  return { contentUrl, contentLoading, contentError };
}
