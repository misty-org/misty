// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
import { createContext, useContext } from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import type { FileItem, FilesPlace } from "../model";
import { samePlace } from "../model";

type Modifiers = { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean };

export interface GoOptions {
  replace?: boolean;
  select?: string[];
  root?: boolean;
}

export interface BrowserState {
  history: FilesPlace[];
  at: number;
  place: FilesPlace;
  columnRoot: FilesPlace;
  selected: ReadonlySet<string>;
  anchor?: string;
  lead?: string;
  query: string;
  cut: ReadonlySet<string>;
  quick: FileItem | null;
  opId: string | null;
  revision: number;
  pathEdit: number;
  multiple: boolean;
  go(next: FilesPlace, options?: GoOptions): void;
  back(): void;
  forward(): void;
  select(ids: readonly string[]): void;
  pick(id: string, order: readonly string[], modifiers?: Modifiers): void;
  move(delta: number, order: readonly string[], extend: boolean): void;
  selectAll(order: readonly string[]): void;
  setQuery(query: string): void;
  setCut(ids: readonly string[]): void;
  setQuick(item: FileItem | null): void;
  setOp(opId: string | null): void;
  bump(): void;
  editPath(): void;
}

const picked = (ids: readonly string[]) => ({
  selected: new Set(ids) as ReadonlySet<string>,
  anchor: ids[0],
  lead: ids[ids.length - 1],
});

const nothing = picked([]);

export function createBrowserStore(start: FilesPlace, multiple: boolean) {
  return createStore<BrowserState>((set, get) => ({
    history: [start],
    at: 0,
    place: start,
    columnRoot: start,
    ...nothing,
    query: "",
    cut: new Set(),
    quick: null,
    opId: null,
    revision: 0,
    pathEdit: 0,
    multiple,
    go: (next, options) => {
      const now = get();
      const root = options?.root ? { columnRoot: next } : {};
      if (samePlace(now.place, next)) {
        set({ ...root, ...(options?.select ? picked(options.select) : {}) });
        return;
      }
      const history = options?.replace
        ? now.history.map((place, index) => (index === now.at ? next : place))
        : [...now.history.slice(0, now.at + 1), next];
      const at = options?.replace ? now.at : now.at + 1;
      set({ ...root, history, at, place: next, query: "", ...picked(options?.select ?? []) });
    },
    back: () => {
      const now = get();
      if (now.at === 0) return;
      set({ at: now.at - 1, place: now.history[now.at - 1], query: "", ...nothing });
    },
    forward: () => {
      const now = get();
      if (now.at >= now.history.length - 1) return;
      set({ at: now.at + 1, place: now.history[now.at + 1], query: "", ...nothing });
    },
    select: (ids) => set(picked(get().multiple ? ids : ids.slice(0, 1))),
    pick: (id, order, modifiers) => {
      const now = get();
      const extend = now.multiple && modifiers?.shiftKey;
      const toggle = now.multiple && (modifiers?.metaKey || modifiers?.ctrlKey);
      if (extend && now.anchor && order.includes(now.anchor) && order.includes(id)) {
        const [from, to] = [order.indexOf(now.anchor), order.indexOf(id)].sort((a, b) => a - b);
        return set({ selected: new Set(order.slice(from, to + 1)), lead: id });
      }
      if (toggle) {
        const next = new Set(now.selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return set({ selected: next, anchor: id, lead: id });
      }
      set(picked([id]));
    },
    move: (delta, order, extend) => {
      if (!order.length) return;
      const now = get();
      const from = now.lead ? order.indexOf(now.lead) : -1;
      const index =
        from < 0
          ? delta > 0
            ? 0
            : order.length - 1
          : Math.min(order.length - 1, Math.max(0, from + delta));
      const id = order[index];
      if (extend && now.multiple) {
        const anchor =
          now.anchor && order.includes(now.anchor) ? now.anchor : order[Math.max(from, 0)];
        const [a, b] = [order.indexOf(anchor), index].sort((x, y) => x - y);
        return set({ selected: new Set(order.slice(a, b + 1)), anchor, lead: id });
      }
      set(picked([id]));
    },
    selectAll: (order) => {
      if (get().multiple) set(picked(order));
    },
    setQuery: (query) => set({ query }),
    setCut: (ids) => set({ cut: new Set(ids) }),
    setQuick: (quick) => set({ quick }),
    setOp: (opId) => set({ opId }),
    bump: () => set((now) => ({ revision: now.revision + 1 })),
    editPath: () => set((now) => ({ pathEdit: now.pathEdit + 1 })),
  }));
}

export type BrowserStore = StoreApi<BrowserState>;

export const BrowserStoreContext = createContext<BrowserStore | null>(null);

export function useBrowserStore(): BrowserStore {
  const store = useContext(BrowserStoreContext);
  if (!store) throw new Error("Files needs its pane around it.");
  return store;
}

export function useBrowser<T>(selector: (state: BrowserState) => T): T {
  return useStore(useBrowserStore(), selector);
}
