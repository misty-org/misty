import type { CropRect } from "@/shared/ui";

/**
 * One image's edit: its turn, mirror, straightening and crop, its light, color and look, the size
 * it saves at, and the marks drawn on it. It is plain data, so people and agents editing the same
 * image at once share it field by field, and it renders in the browser the same way for the
 * preview and for the saved file.
 *
 * Marks are kept in the original image's own space, measured in fractions of its longer side, so
 * they stay put when the image is turned, cropped or straightened afterwards, and land in the same
 * place on a smaller preview and on the full-size file.
 */
export type Rotation = 0 | 90 | 180 | 270;

export const adjustmentIds = [
  "exposure",
  "brightness",
  "contrast",
  "highlights",
  "shadows",
  "saturation",
  "vibrance",
  "warmth",
  "tint",
  "sharpness",
  "vignette",
] as const;
export type AdjustmentId = (typeof adjustmentIds)[number];
export type Adjustments = Record<AdjustmentId, number>;

export const filterIds = [
  "none",
  "vivid",
  "dramatic",
  "warm",
  "cool",
  "fade",
  "mono",
  "noir",
] as const;
export type FilterId = (typeof filterIds)[number];

export const aspectIds = ["free", "original", "square", "4:3", "3:2", "16:9"] as const;
export type AspectId = (typeof aspectIds)[number];

/** A point in the image's own space: fractions of its longer side, from its top left. */
export type Point = { x: number; y: number };
/** A box in the image's own space; width and height are never negative once drawn. */
export type Box = { x: number; y: number; width: number; height: number };

export const markKinds = ["pen", "line", "arrow", "rect", "ellipse", "text", "redact"] as const;
export type MarkKind = (typeof markKinds)[number];

interface MarkBase {
  id: string;
  /** Stacking order: higher draws over lower. */
  z: number;
  /** A CSS color, the mark's own: marks keep their colors in every theme. */
  color: string;
  /** Stroke width, or a text's size, in fractions of the image's longer side. */
  size: number;
  /** Who drew it, for the people editing together. */
  author?: string;
}
export type PenMark = MarkBase & { kind: "pen"; points: Point[] };
export type LineMark = MarkBase & { kind: "line" | "arrow"; from: Point; to: Point };
export type ShapeMark = MarkBase & { kind: "rect" | "ellipse"; box: Box; fill: boolean };
export type RedactMark = MarkBase & { kind: "redact"; box: Box };
export type TextMark = MarkBase & { kind: "text"; at: Point; text: string };
export type Mark = PenMark | LineMark | ShapeMark | RedactMark | TextMark;

export interface ImageEdit {
  rotation: Rotation;
  flipX: boolean;
  flipY: boolean;
  /** Degrees, -45 to 45; the image scales up so no corner shows empty. */
  straighten: number;
  /** Fractions of the turned, mirrored and straightened image. */
  crop: CropRect;
  aspect: AspectId;
  /** Each -100 to 100, 0 leaving the image as it is. */
  adjust: Adjustments;
  filter: FilterId;
  /** How strongly the filter applies, 0 to 100. */
  filterStrength: number;
  /** The size it saves at, or null for the crop's own size. */
  resize: Resize | null;
  marks: Record<string, Mark>;
}

/**
 * A saved size: a scale of the crop, which follows the crop as it changes (its shape held), or
 * exact pixels, which may stretch it.
 */
export type Resize = { scale: number } | { width: number; height: number };

export const fullCrop: CropRect = { x: 0, y: 0, width: 1, height: 1 };

export const noAdjustments = Object.fromEntries(adjustmentIds.map((id) => [id, 0])) as Adjustments;

export const defaultImageEdit: ImageEdit = {
  rotation: 0,
  flipX: false,
  flipY: false,
  straighten: 0,
  crop: fullCrop,
  aspect: "free",
  adjust: noAdjustments,
  filter: "none",
  filterStrength: 100,
  resize: null,
  marks: {},
};

/** Fills in anything an edit from elsewhere (an older save, an agent) left out or got wrong. */
export function normalizeImageEdit(value: unknown): ImageEdit {
  const input = (value && typeof value === "object" ? value : {}) as Partial<ImageEdit>;
  const number = (candidate: unknown, low: number, high: number, fallback: number) =>
    typeof candidate === "number" && Number.isFinite(candidate)
      ? Math.min(high, Math.max(low, candidate))
      : fallback;
  const rotation = ([0, 90, 180, 270] as const).includes(input.rotation as Rotation)
    ? (input.rotation as Rotation)
    : 0;
  const crop = normalizeCrop(input.crop);
  const adjust = { ...noAdjustments };
  for (const id of adjustmentIds) adjust[id] = number(input.adjust?.[id], -100, 100, 0);
  const marks: Record<string, Mark> = {};
  for (const [id, mark] of Object.entries(input.marks ?? {})) {
    const normal = normalizeMark({ ...(mark as Mark), id });
    if (normal) marks[id] = normal;
  }
  const resize = normalizeResize(input.resize);
  return {
    rotation,
    flipX: input.flipX === true,
    flipY: input.flipY === true,
    straighten: number(input.straighten, -45, 45, 0),
    crop,
    aspect: aspectIds.includes(input.aspect as AspectId) ? (input.aspect as AspectId) : "free",
    adjust,
    filter: filterIds.includes(input.filter as FilterId) ? (input.filter as FilterId) : "none",
    filterStrength: number(input.filterStrength, 0, 100, 100),
    resize,
    marks,
  };
}

/** The largest side a saved image may have. */
export const maxSide = 16_384;

function normalizeResize(value: unknown): Resize | null {
  if (!value || typeof value !== "object") return null;
  const resize = value as Partial<{ scale: number; width: number; height: number }>;
  if (typeof resize.scale === "number" && Number.isFinite(resize.scale) && resize.scale > 0)
    return resize.scale === 1 ? null : { scale: Math.min(16, Math.max(0.01, resize.scale)) };
  if (
    typeof resize.width === "number" &&
    typeof resize.height === "number" &&
    Number.isFinite(resize.width) &&
    Number.isFinite(resize.height) &&
    resize.width >= 1 &&
    resize.height >= 1
  )
    return {
      width: Math.min(maxSide, Math.round(resize.width)),
      height: Math.min(maxSide, Math.round(resize.height)),
    };
  return null;
}

function normalizeCrop(value: unknown): CropRect {
  const crop = value as Partial<CropRect> | undefined;
  if (
    !crop ||
    ![crop.x, crop.y, crop.width, crop.height].every(
      (part) => typeof part === "number" && Number.isFinite(part),
    )
  )
    return fullCrop;
  const width = Math.min(1, Math.max(0.01, crop.width!));
  const height = Math.min(1, Math.max(0.01, crop.height!));
  return {
    x: Math.min(1 - width, Math.max(0, crop.x!)),
    y: Math.min(1 - height, Math.max(0, crop.y!)),
    width,
    height,
  };
}

const finitePoint = (point: unknown): point is Point =>
  Boolean(point) &&
  typeof (point as Point).x === "number" &&
  typeof (point as Point).y === "number" &&
  Number.isFinite((point as Point).x) &&
  Number.isFinite((point as Point).y);

const finiteBox = (box: unknown): box is Box =>
  finitePoint(box) &&
  typeof (box as Box).width === "number" &&
  typeof (box as Box).height === "number" &&
  Number.isFinite((box as Box).width) &&
  Number.isFinite((box as Box).height);

/** A mark as it should be, or null when it can't be drawn. */
export function normalizeMark(mark: Mark): Mark | null {
  if (!mark || typeof mark !== "object" || !markKinds.includes(mark.kind)) return null;
  const base = {
    id: String(mark.id),
    z: typeof mark.z === "number" && Number.isFinite(mark.z) ? mark.z : 0,
    color:
      typeof mark.color === "string" && mark.color.length <= 64 ? mark.color : markColors[0].value,
    size:
      typeof mark.size === "number" && Number.isFinite(mark.size)
        ? Math.min(0.5, Math.max(0.0005, mark.size))
        : strokeSizes[1].value,
    ...(typeof mark.author === "string" ? { author: mark.author.slice(0, 80) } : {}),
  };
  switch (mark.kind) {
    case "pen":
      return Array.isArray(mark.points) && mark.points.every(finitePoint) && mark.points.length > 0
        ? {
            ...base,
            kind: "pen",
            points: mark.points.slice(0, 20_000).map(({ x, y }) => ({ x, y })),
          }
        : null;
    case "line":
    case "arrow":
      return finitePoint(mark.from) && finitePoint(mark.to)
        ? { ...base, kind: mark.kind, from: { ...mark.from }, to: { ...mark.to } }
        : null;
    case "rect":
    case "ellipse":
      return finiteBox(mark.box)
        ? { ...base, kind: mark.kind, box: positiveBox(mark.box), fill: mark.fill === true }
        : null;
    case "redact":
      return finiteBox(mark.box) ? { ...base, kind: "redact", box: positiveBox(mark.box) } : null;
    case "text":
      return finitePoint(mark.at) && typeof mark.text === "string"
        ? { ...base, kind: "text", at: { ...mark.at }, text: mark.text.slice(0, 2_000) }
        : null;
  }
}

export function positiveBox(box: Box): Box {
  return {
    x: Math.min(box.x, box.x + box.width),
    y: Math.min(box.y, box.y + box.height),
    width: Math.abs(box.width),
    height: Math.abs(box.height),
  };
}

export function sameImageEdit(a: ImageEdit, b: ImageEdit): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Whether the edit leaves the picture itself as it was (marks and size aside). */
export function photoUntouched(edit: ImageEdit): boolean {
  return (
    edit.rotation === 0 &&
    !edit.flipX &&
    !edit.flipY &&
    edit.straighten === 0 &&
    sameCrop(edit.crop, fullCrop) &&
    edit.filter === "none" &&
    adjustmentIds.every((id) => edit.adjust[id] === 0)
  );
}

export function sameCrop(a: CropRect, b: CropRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

// ---------------------------------------------------------------------------------------------
// Mark styles

/** The colors marks are drawn in: the same in every theme, since they are part of the image. */
export const markColors = [
  { value: "#ff3b30", label: "Red" },
  { value: "#ff9500", label: "Orange" },
  { value: "#ffcc00", label: "Yellow" },
  { value: "#34c759", label: "Green" },
  { value: "#0a84ff", label: "Blue" },
  { value: "#bf5af2", label: "Purple" },
  { value: "#ffffff", label: "White" },
  { value: "#1c1c1e", label: "Black" },
] as const;

/** Stroke widths, in fractions of the image's longer side. */
export const strokeSizes = [
  { id: "thin", label: "Thin", value: 0.003 },
  { id: "regular", label: "Regular", value: 0.006 },
  { id: "bold", label: "Bold", value: 0.012 },
] as const;

/** Text sizes, in fractions of the image's longer side. */
export const textSizes = [
  { id: "small", label: "Small", value: 0.024 },
  { id: "medium", label: "Medium", value: 0.04 },
  { id: "large", label: "Large", value: 0.064 },
] as const;

/** The style preset nearest to a size, for showing which one a mark uses. */
export function nearestPreset<T extends { id: string; value: number }>(
  presets: readonly T[],
  size: number,
): T {
  return presets.reduce((best, preset) =>
    Math.abs(Math.log(preset.value / size)) < Math.abs(Math.log(best.value / size)) ? preset : best,
  );
}

// ---------------------------------------------------------------------------------------------
// Geometry

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

/** A new mark id, unique across everyone editing. */
export function newMarkId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** The highest stacking order among the marks, so a new one goes on top. */
export function topZ(marks: Record<string, Mark>): number {
  let top = 0;
  for (const mark of Object.values(marks)) top = Math.max(top, mark.z);
  return top;
}
