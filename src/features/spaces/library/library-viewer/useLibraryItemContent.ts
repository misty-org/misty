import { preloadPhoto } from "@/features/files";
import { spacesApi } from "../../api/api";
import type { SpaceLibraryItem } from "../../api/dto/entities";
import { useEffect, useState } from "react";
import {
  cachedContent,
  holdContent,
  libraryViewKey,
  loadContent,
  prefetchContent,
} from "./libraryContentCache";
import { libraryMediaKind } from "./libraryMediaKind";
import { libraryItemMIME } from "../library-primitives/libraryMediaTypes";

interface LibraryItemContent {
  contentUrl: string;
  contentLoading: boolean;
  contentError: string;
}

/**
 * Loads the bytes for the item on screen, as an object URL, kept for the session so opening it
 * again shows it at once (libraryContentCache.ts).
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
  // What it is on screen: the file at this version, as the original (editing) or for viewing; a
  // preview made since the last look is a new key, so it loads.
  const key = !item
    ? ""
    : editing
      ? [spaceId, item.id, item.version, "original"].join(":")
      : libraryViewKey(spaceId, item.id, item.version, itemIsImage ? (renditionState ?? "") : "");
  // Shown at once when it was loaded before this session.
  const [loaded, setLoaded] = useState(() => ({ key, url: key ? (cachedContent(key) ?? "") : "" }));
  const [contentError, setContentError] = useState("");
  const [contentLoading, setContentLoading] = useState(false);

  useEffect(() => {
    if (!item || !key) {
      setLoaded({ key: "", url: "" });
      setContentError("");
      return;
    }
    const known = cachedContent(key);
    if (known) {
      setLoaded({ key, url: known });
      setContentError("");
      setContentLoading(false);
      return;
    }
    let current = true;
    setContentLoading(true);
    setContentError("");

    const request = () =>
      itemIsImage
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

    void loadContent(key, request)
      .then((url) => current && setLoaded({ key, url }))
      .catch(
        (error: unknown) =>
          current &&
          setContentError(
            error instanceof Error ? error.message : "The file reader could not load this item.",
          ),
      )
      .finally(() => current && setContentLoading(false));

    // The URL stays in the cache for the next time it's opened, so it isn't revoked here.
    return () => {
      current = false;
    };
    // `item` is read through its id and version, which are in the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // What is on screen is never let go from the cache under it.
  const shown = loaded.key === key && loaded.url ? key : "";
  useEffect(() => (shown ? holdContent(shown) : undefined), [shown]);

  return {
    contentUrl: loaded.key === key ? loaded.url : (key && cachedContent(key)) || "",
    contentLoading,
    contentError,
  };
}

/**
 * Fetches and decodes the images either side of the one on screen once it has shown, as Preview
 * does, so the arrow keys step through a Library without waiting. Only images are fetched ahead:
 * other files can be large, and aren't stepped through the same way.
 */
export function usePrefetchLibraryNeighbors(options: {
  spaceId: string;
  items: SpaceLibraryItem[];
  index: number;
  /** Whether the item on screen has shown; nothing is fetched ahead of it. */
  ready: boolean;
}) {
  const { spaceId, items, index, ready } = options;
  const neighbors = [items[index + 1], items[index - 1]].filter(
    (item): item is SpaceLibraryItem =>
      Boolean(item) &&
      libraryMediaKind(libraryItemMIME(item), item.file.intrinsic_metadata).isImage,
  );
  const wanted = neighbors.map((item) => `${item.id}@${item.version}`).join(",");
  useEffect(() => {
    if (!ready || neighbors.length === 0) return;
    let current = true;
    for (const item of neighbors)
      void prefetchContent(libraryViewKey(spaceId, item.id, item.version), () =>
        spacesApi
          .libraryPreview(spaceId, item.id, item.version)
          .catch(() => spacesApi.libraryContent(spaceId, item.id)),
      ).then((url) => {
        if (current && url) preloadPhoto(url);
      });
    return () => {
      current = false;
    };
    // The neighbors are read through their ids and versions, in `wanted`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, spaceId, wanted]);
}
