import type { ReactNode } from "react";
import { itemToneClass, type ItemTone } from "../../icons/itemTones";

export type CollectionItem = {
  id: string;
  title: string;
  /**
   * The item's type glyph. Grid cards show it; list rows start with their text and leave it out.
   */
  icon?: ReactNode;
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
  /** Whether modifier-click can select this item for a bulk action. */
  selectable?: boolean;
  /**
   * The item's actions as menu rows (MenuItem, MenuCheckItem, MenuSubmenu…). They open from the
   * ⋯ at the row's or card's right end on hover and from a right-click anywhere on it, so an item
   * has its actions in one place.
   */
  menu?: ReactNode;
  /** The ⋯ button's name and tooltip. Defaults to "Actions for {title}". */
  menuLabel?: string;
  /** Called as either menu opens, before its rows are used, e.g. to point a selection at it. */
  onMenuOpen?: () => void;
  marker?: ReactNode;
};

/** The icon slot's glyph color: the item's tone, or the muted default. */
export function collectionIconTone(item: Pick<CollectionItem, "tone">) {
  return item.tone ? itemToneClass(item.tone) : "text-cream-muted";
}

/** Whether the item has a menu of actions. */
export function hasItemActions(item: CollectionItem) {
  return item.menu !== undefined && item.menu !== null && item.menu !== false;
}

/** The ⋯ name for an item's menu. */
export function itemMenuLabel(item: CollectionItem) {
  return item.menuLabel ?? `Actions for ${item.title}`;
}

/** Calls the item's open hook as one of its menus opens. */
export function itemMenuOpened(item: CollectionItem) {
  return (open: boolean) => {
    if (open) item.onMenuOpen?.();
  };
}

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
