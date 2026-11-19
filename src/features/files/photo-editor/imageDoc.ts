import type * as Y from "yjs";
import {
  adjustmentIds,
  defaultImageEdit,
  normalizeImageEdit,
  type ImageEdit,
  type Mark,
} from "./imageEdit";

/**
 * An image's edit as a shared document. Each setting is its own field and each mark its own
 * entry, so two people (or a person and an agent) changing different things never undo each
 * other: one moving the exposure while another draws an arrow both land.
 *
 *   image:edit    rotation, flipX, flipY, straighten, crop, aspect, filter, filterStrength, resize
 *   image:adjust  one number per adjustment
 *   image:marks   mark id → mark
 *   image:meta    base: the library version the edit applies to; savedBy, savedAt
 */
export interface ImageDocParts {
  doc: Y.Doc;
  edit: Y.Map<unknown>;
  adjust: Y.Map<number>;
  marks: Y.Map<Mark>;
  meta: Y.Map<unknown>;
}

const editKeys = [
  "rotation",
  "flipX",
  "flipY",
  "straighten",
  "crop",
  "aspect",
  "filter",
  "filterStrength",
  "resize",
] as const satisfies readonly (keyof ImageEdit)[];

/** Changes made here, as opposed to ones that arrived from someone else. Undo follows only these. */
export const localImageOrigin = { image: "local" } as const;

export function imageDocParts(doc: Y.Doc): ImageDocParts {
  return {
    doc,
    edit: doc.getMap("image:edit"),
    adjust: doc.getMap<number>("image:adjust"),
    marks: doc.getMap<Mark>("image:marks"),
    meta: doc.getMap("image:meta"),
  };
}

/** The edit the document holds now, with anything missing or malformed set right. */
export function readImageEdit(parts: ImageDocParts): ImageEdit {
  const raw: Record<string, unknown> = {};
  for (const key of editKeys) if (parts.edit.has(key)) raw[key] = parts.edit.get(key);
  const adjust: Record<string, number> = {};
  for (const id of adjustmentIds) adjust[id] = parts.adjust.get(id) ?? 0;
  const marks: Record<string, Mark> = {};
  parts.marks.forEach((mark, id) => {
    marks[id] = mark;
  });
  return normalizeImageEdit({ ...raw, adjust, marks });
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Writes only what differs between `next` and the document, in one change. */
export function writeImageEdit(
  parts: ImageDocParts,
  next: ImageEdit,
  origin: unknown = localImageOrigin,
) {
  const current = readImageEdit(parts);
  parts.doc.transact(() => {
    for (const key of editKeys) {
      if (same(current[key], next[key])) continue;
      if (same(next[key], defaultImageEdit[key])) parts.edit.delete(key);
      else parts.edit.set(key, next[key]);
    }
    for (const id of adjustmentIds) {
      if (current.adjust[id] === next.adjust[id]) continue;
      if (next.adjust[id] === 0) parts.adjust.delete(id);
      else parts.adjust.set(id, next.adjust[id]);
    }
    for (const id of Object.keys(current.marks)) if (!(id in next.marks)) parts.marks.delete(id);
    for (const [id, mark] of Object.entries(next.marks))
      if (!same(current.marks[id], mark)) parts.marks.set(id, { ...mark, id });
  }, origin);
}

/** Clears the edit, as after it was saved into the image or the image changed underneath it. */
export function clearImageEdit(parts: ImageDocParts, base: string, origin: unknown) {
  parts.doc.transact(() => {
    parts.edit.clear();
    parts.adjust.clear();
    parts.marks.clear();
    parts.meta.set("base", base);
  }, origin);
}

/** The library version the document's edit was made on, if it says. */
export function imageDocBase(parts: ImageDocParts): string | null {
  const base = parts.meta.get("base");
  return typeof base === "string" ? base : null;
}

/** Whether anything is edited at all. */
export function imageDocEmpty(parts: ImageDocParts): boolean {
  return parts.edit.size === 0 && parts.adjust.size === 0 && parts.marks.size === 0;
}
