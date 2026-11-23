import { createContext, useContext, type RefObject } from "react";
import type { FileActions } from "./file_actions";
import type { FilesPick } from "./files_choices";
import type { FileItem } from "./model";
import type { BrowserStore } from "./store/browser_store";

export interface ShownOrder {
  ids: string[];
  perRow: number;
}

export interface PaneApi {
  store: BrowserStore;
  granted: boolean;
  pick?: FilesPick;
  actions: FileActions;
  shown: RefObject<Map<string, FileItem>>;
  order: RefObject<ShownOrder>;
  searchRef: RefObject<HTMLInputElement | null>;
}

export const PaneContext = createContext<PaneApi | null>(null);

export function usePane(): PaneApi {
  const pane = useContext(PaneContext);
  if (!pane) throw new Error("Files needs its pane around it.");
  return pane;
}

export function targetsOf(pane: PaneApi, item: FileItem): FileItem[] {
  const selected = pane.store.getState().selected;
  if (!selected.has(item.id)) return [item];
  const shown = pane.shown.current;
  return [...selected].flatMap((id) => shown.get(id) ?? []);
}
