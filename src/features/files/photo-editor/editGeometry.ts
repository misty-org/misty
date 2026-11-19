/*
 * Where an edit puts things: the turned, straightened and cropped image's sizes and frames.
 */
import type { CropRect } from "@/shared/ui";
import type { ImageEdit, Rotation, AspectId, Point } from "./imageEdit";

export const fullCrop: CropRect = { x: 0, y: 0, width: 1, height: 1 };

/** The largest side a saved image may have. */
export const maxSide = 16_384;

/** The image's size once turned. */
export function turnedSize(width: number, height: number, rotation: Rotation) {
  return rotation % 180 ? { width: height, height: width } : { width, height };
}

/** How much a straightened image grows so it still covers its whole frame. */
export function coverScale(width: number, height: number, degrees: number) {
  const angle = Math.abs((degrees * Math.PI) / 180);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return Math.max((width * cos + height * sin) / width, (width * sin + height * cos) / height);
}

/** The crop's size in the original's pixels: what the image saves at unless it is resized. */
export function croppedSize(
  natural: { width: number; height: number },
  edit: Pick<ImageEdit, "rotation" | "crop">,
) {
  const frame = turnedSize(natural.width, natural.height, edit.rotation);
  return {
    width: Math.max(1, Math.round(frame.width * edit.crop.width)),
    height: Math.max(1, Math.round(frame.height * edit.crop.height)),
  };
}

/** The size the image saves at. */
export function outputSize(
  natural: { width: number; height: number },
  edit: Pick<ImageEdit, "rotation" | "crop" | "resize">,
) {
  const cropped = croppedSize(natural, edit);
  const resize = edit.resize;
  if (!resize) return cropped;
  if ("scale" in resize) {
    // Never past the largest side, keeping the shape.
    const scale = Math.min(resize.scale, maxSide / Math.max(cropped.width, cropped.height));
    return {
      width: Math.max(1, Math.round(cropped.width * scale)),
      height: Math.max(1, Math.round(cropped.height * scale)),
    };
  }
  return { width: resize.width, height: resize.height };
}

/**
 * Where the original's pixels land on a drawing of the edit: from the source's own pixels to the
 * drawing's, at `scale` drawing pixels per frame pixel. `crop: false` draws the whole frame, for
 * cropping over it.
 */
export function sourceToDrawing(
  edit: Pick<ImageEdit, "rotation" | "flipX" | "flipY" | "straighten" | "crop">,
  source: { width: number; height: number },
  options: { scale: number; crop?: boolean },
): DOMMatrix {
  const frame = turnedSize(source.width, source.height, edit.rotation);
  const crop = options.crop === false ? fullCrop : edit.crop;
  const cover = coverScale(frame.width, frame.height, edit.straighten);
  return new DOMMatrix()
    .scaleSelf(options.scale, options.scale)
    .translateSelf(-crop.x * frame.width, -crop.y * frame.height)
    .translateSelf(frame.width / 2, frame.height / 2)
    .rotateSelf(edit.straighten)
    .scaleSelf(cover * (edit.flipX ? -1 : 1), cover * (edit.flipY ? -1 : 1))
    .rotateSelf(edit.rotation)
    .translateSelf(-source.width / 2, -source.height / 2);
}

/**
 * The middle of what the edit shows (its crop), and the length of the crop's shorter side, in the
 * image's own space: where a mark added without a place goes, and how large it starts.
 */
export function cropFrame(
  edit: Pick<ImageEdit, "rotation" | "flipX" | "flipY" | "straighten" | "crop">,
  natural: { width: number; height: number },
): { center: Point; short: number } {
  const side = Math.max(1, natural.width, natural.height);
  const frame = turnedSize(natural.width, natural.height, edit.rotation);
  const width = frame.width * edit.crop.width;
  const height = frame.height * edit.crop.height;
  const cover = coverScale(frame.width, frame.height, edit.straighten);
  // `sourceToDrawing` undone step by step for the crop's middle: from the frame's middle,
  // unstraightened, unscaled and unmirrored, then turned back.
  const turnBack = (point: Point, degrees: number): Point => {
    const angle = (-degrees * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
  };
  let at: Point = {
    x: edit.crop.x * frame.width + width / 2 - frame.width / 2,
    y: edit.crop.y * frame.height + height / 2 - frame.height / 2,
  };
  at = turnBack(at, edit.straighten);
  at = { x: at.x / (cover * (edit.flipX ? -1 : 1)), y: at.y / (cover * (edit.flipY ? -1 : 1)) };
  at = turnBack(at, edit.rotation);
  return {
    center: { x: (at.x + natural.width / 2) / side, y: (at.y + natural.height / 2) / side },
    short: Math.min(width, height) / cover / side,
  };
}

/** The crop's width over height in pixels for an aspect, in the crop's current orientation. */
export function aspectRatio(
  aspect: AspectId,
  edit: Pick<ImageEdit, "crop">,
  frame: { width: number; height: number },
): number | null {
  const ratios: Record<Exclude<AspectId, "free">, number> = {
    original: frame.width / frame.height,
    square: 1,
    "4:3": 4 / 3,
    "3:2": 3 / 2,
    "16:9": 16 / 9,
  };
  if (aspect === "free") return null;
  const ratio = ratios[aspect];
  if (aspect === "original" || aspect === "square") return ratio;
  const portrait = edit.crop.width * frame.width < edit.crop.height * frame.height;
  return portrait ? 1 / ratio : ratio;
}

/** The largest crop of `ratio` that fits the image, centered on where the crop is now. */
export function cropToRatio(
  crop: CropRect,
  ratio: number | null,
  frame: { width: number; height: number },
): CropRect {
  if (!ratio) return crop;
  const shape = (ratio * frame.height) / frame.width;
  let width = 1;
  let height = width / shape;
  if (height > 1) {
    height = 1;
    width = shape;
  }
  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;
  return {
    x: Math.min(1 - width, Math.max(0, centerX - width / 2)),
    y: Math.min(1 - height, Math.max(0, centerY - height / 2)),
    width,
    height,
  };
}

/** Turns the image a quarter, keeping the same part of it cropped. A set size turns with it. */
export function turnEdit(edit: ImageEdit, clockwise: boolean): ImageEdit {
  const { x, y, width, height } = edit.crop;
  const crop = clockwise
    ? { x: 1 - y - height, y: x, width: height, height: width }
    : { x: y, y: 1 - x - width, width: height, height: width };
  const rotation = ((edit.rotation + (clockwise ? 90 : 270)) % 360) as Rotation;
  const resize =
    edit.resize && "width" in edit.resize
      ? { width: edit.resize.height, height: edit.resize.width }
      : edit.resize;
  return { ...edit, rotation, crop, resize };
}

/** Mirrors the image, keeping the same part of it cropped. */
export function mirrorEdit(edit: ImageEdit, axis: "x" | "y"): ImageEdit {
  const { x, y, width, height } = edit.crop;
  return axis === "x"
    ? { ...edit, flipX: !edit.flipX, crop: { x: 1 - x - width, y, width, height } }
    : { ...edit, flipY: !edit.flipY, crop: { x, y: 1 - y - height, width, height } };
}
