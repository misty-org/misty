import {
  adjustmentIds,
  aspectIds,
  aspectRatio,
  cropToRatio,
  defaultImageEdit,
  filterIds,
  maxSide,
  mirrorEdit,
  newMarkId,
  normalizeImageEdit,
  normalizeMark,
  topZ,
  turnEdit,
  turnedSize,
  type AdjustmentId,
  type AspectId,
  type FilterId,
  type ImageEdit,
  type Mark,
} from "./imageEdit";

/**
 * A checked change to an image's edit, in the plain fields an agent sends (`image.edit`) and the
 * AI pane's reviewed proposals carry: light and color, the filter, a quarter turn, a mirror,
 * straightening, a crop or a crop to a shape, a saved size, and marks to add or remove. Every
 * field is checked; anything malformed is refused whole, so nothing lands half done.
 */

/** A change that doesn't fit: what was wrong with it, in words an agent can act on. */
export class ImageChangeRejected extends Error {}

function reject(message: string): never {
  throw new ImageChangeRejected(message);
}

const finite = (value: unknown, low: number, high: number, name: string): number =>
  typeof value === "number" && Number.isFinite(value) && value >= low && value <= high
    ? value
    : reject(`${name} must be a number from ${low} to ${high}.`);

const plainObject = (value: unknown, name: string): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : reject(`${name} must be an object.`);

function choice<T extends string>(
  input: Record<string, unknown>,
  name: string,
  allowed: readonly T[],
): T | undefined {
  const value = input[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T))
    reject(`${name} must be one of ${allowed.join(", ")}.`);
  return value as T;
}

function yes(input: Record<string, unknown>, name: string): boolean {
  const value = input[name];
  if (value === undefined || value === null) return false;
  if (typeof value !== "boolean") reject(`${name} must be true or false.`);
  return value === true;
}

/** The change's fields; anything else is refused, so a misspelled field never passes unseen. */
export const imageChangeFields = [
  "reset",
  "adjust",
  "filter",
  "filter_strength",
  "rotate",
  "flip",
  "straighten",
  "crop",
  "aspect",
  "resize",
  "clear_marks",
  "remove_mark_ids",
  "add_marks",
] as const;

/**
 * The edit after `changes`, checked field by field. `natural` is the original's size, which an
 * aspect given without a crop needs to crop to that shape; without it the aspect is only kept.
 * `ignore` names other fields the caller reads itself (an item id, a Space).
 */
export function applyImageChanges(
  current: ImageEdit,
  changes: Record<string, unknown>,
  options: {
    author: string;
    natural?: { width: number; height: number } | null;
    ignore?: readonly string[];
  },
): ImageEdit {
  for (const key of Object.keys(changes))
    if (!(imageChangeFields as readonly string[]).includes(key) && !options.ignore?.includes(key))
      reject(`${key} isn't something an image edit can change.`);

  let next: ImageEdit = yes(changes, "reset") ? { ...defaultImageEdit } : { ...current };
  if (changes.adjust !== undefined) {
    const adjust = plainObject(changes.adjust, "adjust");
    const values = { ...next.adjust };
    for (const [id, value] of Object.entries(adjust)) {
      if (!adjustmentIds.includes(id as AdjustmentId))
        reject(`adjust.${id} isn't an adjustment; use ${adjustmentIds.join(", ")}.`);
      values[id as AdjustmentId] = Math.round(finite(value, -100, 100, `adjust.${id}`));
    }
    next.adjust = values;
  }
  const filter = choice<FilterId>(changes, "filter", filterIds);
  if (filter) next.filter = filter;
  if (changes.filter_strength !== undefined)
    next.filterStrength = finite(changes.filter_strength, 0, 100, "filter_strength");

  const rotate = choice(changes, "rotate", ["left", "right"] as const);
  if (rotate) next = turnEdit(next, rotate === "right");
  const flip = choice(changes, "flip", ["horizontal", "vertical"] as const);
  if (flip) next = mirrorEdit(next, flip === "horizontal" ? "x" : "y");
  if (changes.straighten !== undefined)
    next.straighten = finite(changes.straighten, -45, 45, "straighten");

  if (changes.crop !== undefined) {
    const crop = plainObject(changes.crop, "crop");
    next.crop = {
      x: finite(crop.x, 0, 1, "crop.x"),
      y: finite(crop.y, 0, 1, "crop.y"),
      width: finite(crop.width, 0.01, 1, "crop.width"),
      height: finite(crop.height, 0.01, 1, "crop.height"),
    };
  }
  const aspect = choice<AspectId>(changes, "aspect", aspectIds);
  if (aspect) {
    next.aspect = aspect;
    // An aspect alone crops to its shape, centered on the crop as it is, as picking it does.
    const natural = options.natural;
    if (changes.crop === undefined && aspect !== "free" && natural?.width && natural.height) {
      const frame = turnedSize(natural.width, natural.height, next.rotation);
      next.crop = cropToRatio(next.crop, aspectRatio(aspect, next, frame), frame);
    }
  }
  if (changes.resize !== undefined && changes.resize !== null) {
    const resize = plainObject(changes.resize, "resize");
    if (resize.scale !== undefined)
      next.resize = { scale: finite(resize.scale, 0.01, 16, "resize.scale") };
    else if (resize.width !== undefined && resize.height !== undefined)
      next.resize = {
        width: Math.round(finite(resize.width, 1, maxSide, "resize.width")),
        height: Math.round(finite(resize.height, 1, maxSide, "resize.height")),
      };
    else next.resize = null;
  } else if (changes.resize === null) next.resize = null;

  const marks = { ...next.marks };
  if (yes(changes, "clear_marks")) for (const id of Object.keys(marks)) delete marks[id];
  if (changes.remove_mark_ids !== undefined) {
    const ids = changes.remove_mark_ids;
    if (!Array.isArray(ids) || ids.length > 500 || ids.some((id) => typeof id !== "string"))
      reject("remove_mark_ids must be a list of at most 500 mark ids.");
    for (const id of ids as string[]) delete marks[id];
  }
  if (changes.add_marks !== undefined) {
    if (!Array.isArray(changes.add_marks) || changes.add_marks.length > 200)
      reject("add_marks must be a list of at most 200 marks.");
    let z = topZ(marks);
    for (const [index, raw] of (changes.add_marks as unknown[]).entries()) {
      const fields = plainObject(raw, `add_marks[${index}]`);
      const id = newMarkId();
      const mark = normalizeMark({
        color: "#ff3b30",
        ...fields,
        id,
        z: ++z,
        author: options.author,
      } as unknown as Mark);
      if (!mark)
        reject(
          fields.kind === "sticker"
            ? `add_marks[${index}] needs a box and a sticker Misty has, such as shapes:star or flags:FR.`
            : `add_marks[${index}] isn't a mark that can be drawn; check its kind and fields.`,
        );
      marks[id] = mark as Mark;
    }
  }
  next.marks = marks;
  return normalizeImageEdit(next);
}
