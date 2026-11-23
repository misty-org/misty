import { useCallback } from "react";
import { createUiMemory, type CollectionZoom } from "@misty/ui";
import type { FileItem } from "./model";
import type { FilesSort } from "./store/arrange_rules";

export type { FilesSort } from "./store/arrange_rules";

export type FilesView = "list" | "grid" | "columns";

interface FilesChoices {
  view?: FilesView;
  hidden?: boolean;
  sidebar?: boolean;
  inspector?: boolean;
  zoom?: CollectionZoom;
  folded?: string[];
  sort?: FilesSort;
}

const sortKeys = new Set(["name", "modified", "size", "kind"]);

const filesMemory = createUiMemory<FilesChoices>({
  scope: "files-browser",
  normalize: (stored) => {
    if (!stored || typeof stored !== "object") return undefined;
    const saved = stored as Record<string, unknown>;
    return {
      view:
        saved.view === "grid" || saved.view === "list" || saved.view === "columns"
          ? saved.view
          : undefined,
      hidden: saved.hidden === true,
      sidebar: typeof saved.sidebar === "boolean" ? saved.sidebar : undefined,
      inspector: typeof saved.inspector === "boolean" ? saved.inspector : undefined,
      zoom: saved.zoom === 0 || saved.zoom === 1 || saved.zoom === 2 ? saved.zoom : undefined,
      folded: Array.isArray(saved.folded)
        ? saved.folded.filter((key): key is string => typeof key === "string")
        : undefined,
      sort:
        saved.sort && typeof saved.sort === "object" && sortKeys.has((saved.sort as FilesSort).key)
          ? {
              key: (saved.sort as FilesSort).key,
              descending: (saved.sort as FilesSort).descending === true,
            }
          : undefined,
    };
  },
});

export interface FilesPick {
  accept: readonly string[];
  multiple: boolean;
  onPick(items: FileItem[]): void;
}

export function useFilesChoices(picking: boolean) {
  const memoryKey = picking ? "picker" : "page";
  const pick = picking;
  const remembered = filesMemory.useEntry(memoryKey);
  const view: FilesView = remembered?.view ?? "list";
  const hidden = remembered?.hidden === true;
  const setView = useCallback(
    (next: FilesView) => filesMemory.set(memoryKey, (now) => ({ ...now, view: next })),
    [memoryKey],
  );
  const toggleHidden = useCallback(
    () => filesMemory.set(memoryKey, (now) => ({ ...now, hidden: !now?.hidden })),
    [memoryKey],
  );
  const sidebar = remembered?.sidebar ?? true;
  const info = remembered?.inspector ?? !pick;
  const zoom: CollectionZoom = remembered?.zoom ?? 1;
  const folded = remembered?.folded ?? [];
  const setSidebar = useCallback(
    (on: boolean) => filesMemory.set(memoryKey, (now) => ({ ...now, sidebar: on })),
    [memoryKey],
  );
  const setInfo = useCallback(
    (next: boolean | ((on: boolean) => boolean)) =>
      filesMemory.set(memoryKey, (now) => {
        const was = now?.inspector ?? !pick;
        return { ...now, inspector: typeof next === "function" ? next(was) : next };
      }),
    [memoryKey, pick],
  );
  const setZoom = useCallback(
    (next: CollectionZoom) => filesMemory.set(memoryKey, (now) => ({ ...now, zoom: next })),
    [memoryKey],
  );
  const setFolded = useCallback(
    (section: string, fold: boolean) =>
      filesMemory.set(memoryKey, (now) => {
        const rest = (now?.folded ?? []).filter((key) => key !== section);
        return { ...now, folded: fold ? [...rest, section] : rest };
      }),
    [memoryKey],
  );

  const setSort = useCallback(
    (next: FilesSort | undefined) => filesMemory.set(memoryKey, (now) => ({ ...now, sort: next })),
    [memoryKey],
  );
  return {
    view,
    setView,
    hidden,
    toggleHidden,
    sidebar,
    setSidebar,
    info,
    setInfo,
    zoom,
    setZoom,
    folded,
    setFolded,
    sort: remembered?.sort,
    setSort,
  };
}
