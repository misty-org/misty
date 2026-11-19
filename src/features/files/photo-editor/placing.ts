import { useMemo } from "react";
import type { MarkStyle } from "./editorTypes";
import { cropFrame, newMarkId, type ImageEdit, type Point, type StickerMark } from "./imageEdit";
import type { PhotoSource } from "./imageRender";
import { stickerById } from "./stickerCatalog";

type Size = { width: number; height: number };

/**
 * The original's size, when the image shown is a smaller copy of it with the same shape;
 * otherwise the shown image's own.
 */
export function useNaturalSize(photo: PhotoSource, given: Size | undefined): Size {
  const givenWidth = given?.width ?? 0;
  const givenHeight = given?.height ?? 0;
  return useMemo(() => {
    const shape = photo.width / photo.height;
    const sameShape =
      givenWidth > 0 &&
      givenHeight > 0 &&
      Math.abs(givenWidth / givenHeight - shape) < 0.02 * shape;
    return sameShape
      ? { width: givenWidth, height: givenHeight }
      : { width: photo.width, height: photo.height };
  }, [givenHeight, givenWidth, photo]);
}

/**
 * A new sticker mark, a third of what the image shows across, centered on `at` or the middle of
 * the view; null for a sticker that doesn't exist. Its z is set when it is added.
 */
export function stickerMarkAt(
  id: string,
  place: { edit: ImageEdit; natural: Size; style: MarkStyle; author?: string; at?: Point },
): StickerMark | null {
  const sticker = stickerById(id);
  if (!sticker) return null;
  const { center, short } = cropFrame(place.edit, place.natural);
  const middle = place.at ?? center;
  const width = short * 0.3;
  const height = width / sticker.aspect;
  return {
    id: newMarkId(),
    kind: "sticker",
    z: 0,
    color: place.style.color,
    size: place.style.stroke,
    box: { x: middle.x - width / 2, y: middle.y - height / 2, width, height },
    sticker: sticker.id,
    opacity: 1,
    ...(place.author ? { author: place.author } : {}),
  };
}
