import {
  normalizeImageEdit,
  type AdjustmentId,
  type FilterId,
  type ImageEdit,
  type Rotation,
} from "./imageEdit";

/**
 * A library edit (the server's non-destructive edit definition, which agents propose) laid onto
 * the live edit: each setting it names replaces the editor's own, on the editor's -100 to 100
 * scale, and settings it leaves out stay as they are. Neutral values (brightness 1, contrast 1,
 * exposure 0) mean no change.
 */
export function applyLibraryEditDefinition(
  edit: ImageEdit,
  definition: Record<string, unknown>,
): ImageEdit {
  const number = (key: string) => {
    const value = definition[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const scaled = (value: number, factor: number) =>
    Math.round(Math.max(-100, Math.min(100, value * factor)));
  const adjust = { ...edit.adjust };
  const set = (id: AdjustmentId, value: number | null, toEditor: (value: number) => number) => {
    if (value !== null) adjust[id] = toEditor(value);
  };
  // Multipliers: 1 is unchanged, 0 to 3 across.
  set("brightness", number("brightness"), (value) => scaled(value - 1, 100));
  set("contrast", number("contrast"), (value) => scaled(value - 1, 100));
  set("saturation", number("saturation"), (value) => scaled(value - 1, 100));
  // Stops: -2 to 2.
  set("exposure", number("exposure"), (value) => scaled(value, 50));
  // -1 to 1.
  set("highlights", number("highlights"), (value) => scaled(value, 100));
  set("shadows", number("shadows"), (value) => scaled(value, 100));
  set("vibrance", number("vibrance"), (value) => scaled(value, 100));
  set("warmth", number("warmth"), (value) => scaled(value, 100));
  set("tint", number("tint"), (value) => scaled(value, 100));
  // 0 to 2, and 0 to 1.
  set("sharpness", number("sharpness"), (value) => scaled(value, 50));
  set("vignette", number("vignette"), (value) => scaled(value, 100));

  const next: ImageEdit = { ...edit, adjust };
  const filter = definition.filter;
  const filters: FilterId[] = ["vivid", "dramatic", "warm", "cool", "mono", "noir"];
  if (filter === "") next.filter = "none";
  else if (typeof filter === "string" && filters.includes(filter as FilterId))
    next.filter = filter as FilterId;
  const grayscale = number("grayscale");
  if (grayscale !== null && grayscale >= 0.5 && next.filter === "none") next.filter = "mono";
  const straighten = number("straighten");
  if (straighten !== null) next.straighten = Math.max(-45, Math.min(45, straighten));
  const rotation = number("rotation");
  if (rotation !== null && [0, 90, 180, 270].includes(rotation))
    next.rotation = rotation as Rotation;
  if (typeof definition.flip_horizontal === "boolean") next.flipX = definition.flip_horizontal;
  if (typeof definition.flip_vertical === "boolean") next.flipY = definition.flip_vertical;
  return normalizeImageEdit(next);
}
