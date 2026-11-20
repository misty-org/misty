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
 * Images prefer the cheaper server-side preview and fall back to the file itself.
 */
export function useLibraryItemContent(options: {
  spaceId: string;
  item: SpaceLibraryItem | null;
  itemIsImage: boolean;
}): LibraryItemContent {
  const { spaceId, item, itemIsImage } = options;
  // What it is on screen: the file at this version.
  const key = !item ? "" : libraryViewKey(spaceId, item.id, item.version);
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
        ? spacesApi
            .libraryPreview(spaceId, item.id, item.version)
            .catch(() => spacesApi.libraryContent(spaceId, item.id))
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
        // Decoded ahead, so stepping to it shows it at once.
        if (current && url) void Object.assign(new Image(), { src: url }).decode().catch(() => {});
      });
    return () => {
      current = false;
    };
    // The neighbors are read through their ids and versions, in `wanted`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, spaceId, wanted]);
}
