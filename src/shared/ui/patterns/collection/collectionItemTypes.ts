import type { ReactNode } from "react";
import { itemToneClass, type ItemTone } from "../../icons/itemTones";

export type CollectionItem = {
  id: string;
  title: string;
  icon: ReactNode;
  /** Glyph color for the item type; omit for artwork that brings its own colors. */
  tone?: ItemTone;
  preview?: ReactNode;
  category: string;
  updated: string;
  updatedAt?: string;
  metadata?: Record<string, string | number | undefined>;
  sortValues?: Record<string, string | number | undefined>;
  creator?: string;
  creatorDescription?: string;
  onOpen: () => void;
  actions?: ReactNode;
  marker?: ReactNode;
  contextMenu?: ReactNode;
};

/** The icon slot's glyph color: the item's tone, or the muted default. */
export function collectionIconTone(item: Pick<CollectionItem, "tone">) {
  return item.tone ? itemToneClass(item.tone) : "text-cream-muted";
}

/** Reveals row and card utilities on hover, focus, or while one of their menus is open. */
export const collectionUtilityReveal = [
  "pointer-events-none opacity-0",
  "group-hover/collection-item:pointer-events-auto group-hover/collection-item:opacity-100",
  "group-focus-within/collection-item:pointer-events-auto",
  "group-focus-within/collection-item:opacity-100",
  "group-data-[state=open]/collection-item:pointer-events-auto",
  "group-data-[state=open]/collection-item:opacity-100",
  "group-has-[[data-state=open]]/collection-item:pointer-events-auto",
  "group-has-[[data-state=open]]/collection-item:opacity-100",
].join(" ");

export type CollectionColumn = {
  key: string;
  label: string;
  render: (item: CollectionItem) => ReactNode;
  sortValue: (item: CollectionItem) => string | number | undefined;
};

export function compareCollectionValues(
  a: string | number | undefined,
  b: string | number | undefined,
  descending: boolean,
) {
  const missing = (value: typeof a) =>
    value === undefined ||
    value === "" ||
    value === "—" ||
    (typeof value === "number" && !Number.isFinite(value));
  if (missing(a)) return missing(b) ? 0 : 1;
  if (missing(b)) return -1;
  const comparison =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  return descending ? -comparison : comparison;
}
