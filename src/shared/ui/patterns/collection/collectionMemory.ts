import { useState } from "react";
import { createDeviceSettingMap } from "@/shared/lib/deviceSettingMap";

type View = "grid" | "list";

/**
 * What a person chose for a collection whose caller passed a `remember` key: its view, its
 * filter menu, its hidden columns and its header sort. Kept in `misty.db` for this device.
 */
export type CollectionMemory = {
  view?: View;
  refinement?: { period: string; sort: string; facet: string };
  hidden?: string[];
  /** `scope` is the table's shape and menu order it was picked under; elsewhere it doesn't apply. */
  tableSort?: { key: string; descending: boolean; scope: string };
};

const periods = ["all", "7", "30"];
const sorts = ["default", "recent", "oldest", "name", "name-desc"];

const record = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

export const collectionMemory = createDeviceSettingMap<CollectionMemory>({
  scope: "collections",
  normalize: (stored) => {
    const saved = record(stored);
    if (!saved) return undefined;
    const entry: CollectionMemory = {};
    if (saved.view === "grid" || saved.view === "list") entry.view = saved.view;
    const refinement = record(saved.refinement);
    if (refinement)
      entry.refinement = {
        period: periods.includes(refinement.period as string)
          ? (refinement.period as string)
          : "all",
        sort: sorts.includes(refinement.sort as string) ? (refinement.sort as string) : "default",
        facet: typeof refinement.facet === "string" ? refinement.facet : "all",
      };
    if (Array.isArray(saved.hidden))
      entry.hidden = saved.hidden.filter((key): key is string => typeof key === "string");
    const tableSort = record(saved.tableSort);
    if (tableSort && typeof tableSort.key === "string" && typeof tableSort.scope === "string")
      entry.tableSort = {
        key: tableSort.key,
        descending: tableSort.descending === true,
        scope: tableSort.scope,
      };
    return entry;
  },
});

/** Changes part of one remembered collection's entry. */
export function rememberCollection(key: string, change: Partial<CollectionMemory>) {
  collectionMemory.set(key, (entry) => ({ ...entry, ...change }));
}

/**
 * A collection's grid or list view. With `remember` it is kept on this device under that key;
 * without, it lasts as long as the page.
 */
export function useCollectionView(remember: string | undefined, initial: View) {
  const [local, setLocal] = useState(initial);
  const saved = collectionMemory.useEntry(remember)?.view;
  const view = remember ? (saved ?? initial) : local;
  const setView = (next: View) =>
    remember ? rememberCollection(remember, { view: next }) : setLocal(next);
  return [view, setView] as const;
}
