import { libraryApi as spacesApi } from "@/features/spaces/library/libraryRuntime";
import type { LibraryAssetStack, SpaceLibraryItem } from "@/api/spaces/dto/interfaces/types";
import { useEffect, useState } from "react";
import { createLongExposureImage } from "../SpaceLibraryViewerUtils";

export interface LibraryItemContent {
  contentUrl: string;
  contentLoading: boolean;
  contentError: string;
}

/**
 * Loads the bytes for whichever stack member is on screen, as an object URL.
 *
 * Which endpoint is used depends on what the viewer is doing: editing needs the
 * untouched original, plain viewing prefers the cheaper server-side preview,
 * and a long-exposure Live Photo is composited locally from its motion clip.
 */
export function useLibraryItemContent(options: {
  spaceId: string;
  item: SpaceLibraryItem | null;
  assetStack: LibraryAssetStack | null;
  reauthenticationToken: string;
  editing: boolean;
  itemIsImage: boolean;
  stackMediaID: string;
  stackMediaIsImage: boolean;
  stackMediaMIME: string;
  stackMediaVersion: number | undefined;
  renditionState: string | undefined;
}): LibraryItemContent {
  const { spaceId, item, assetStack, reauthenticationToken, editing, stackMediaID } = options;
  const { itemIsImage, stackMediaIsImage, stackMediaMIME, stackMediaVersion, renditionState } =
    options;
  const [contentUrl, setContentUrl] = useState("");
  const [contentError, setContentError] = useState("");
  const [contentLoading, setContentLoading] = useState(false);

  useEffect(() => {
    if (!item || !stackMediaID) {
      setContentUrl("");
      setContentError("");
      return;
    }
    let current = true;
    let objectUrl = "";
    setContentLoading(true);
    setContentError("");

    const version = stackMediaVersion ?? item.version;
    const showingCover = stackMediaID === item.id;
    const longExposureMotionID =
      assetStack?.kind === "live_photo" && assetStack.effect === "long_exposure" && showingCover
        ? assetStack.motion_item_id
        : "";
    const request = longExposureMotionID
      ? spacesApi
          .libraryContent(spaceId, longExposureMotionID, reauthenticationToken)
          .then(createLongExposureImage)
      : (editing || itemIsImage) && showingCover
        ? stackMediaIsImage
          ? spacesApi
              .libraryOriginalPreview(spaceId, stackMediaID, reauthenticationToken, version)
              .catch(() =>
                spacesApi.libraryOriginalContent(spaceId, stackMediaID, reauthenticationToken),
              )
          : spacesApi.libraryOriginalContent(spaceId, stackMediaID, reauthenticationToken)
        : stackMediaIsImage
          ? spacesApi
              .libraryPreview(spaceId, stackMediaID, reauthenticationToken, version)
              .catch(() => spacesApi.libraryContent(spaceId, stackMediaID, reauthenticationToken))
          : spacesApi.libraryContent(spaceId, stackMediaID, reauthenticationToken);

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
  }, [
    assetStack?.effect,
    assetStack?.kind,
    assetStack?.motion_item_id,
    editing,
    item,
    itemIsImage,
    reauthenticationToken,
    renditionState,
    spaceId,
    stackMediaID,
    stackMediaIsImage,
    stackMediaMIME,
    stackMediaVersion,
  ]);

  return { contentUrl, contentLoading, contentError };
}
