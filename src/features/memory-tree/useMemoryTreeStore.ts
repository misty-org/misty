import { create } from "zustand";
import { ApiRequestError } from "@/api/client";
import { memoryApi } from "@/features/recall";
import { treeApi } from "./api";
import {
  type ForgetCounts,
  type MemoryBranch,
  type MemoryNode,
  type MemoryRange,
  momentGroupId,
  type NewMemory,
} from "./model";

type Status = "loading" | "ready" | "error" | "unavailable";

interface MemoryTreeState {
  spaceId: string;
  range: MemoryRange;
  /** Loaded children by parent id; the branches are under "". */
  children: Record<string, MemoryNode[]>;
  expanded: ReadonlySet<string>;
  /** Branch and group ids, and `source:<name>`, the filters hide. */
  hidden: ReadonlySet<string>;
  selectedId: string | null;
  status: Status;
  query: string;
  matchIds: ReadonlySet<string>;
  /** What the Forget dialog is asking about, if open. */
  forgetTarget: { id: string; label: string } | null;
  askForget: (target: { id: string; label: string } | null) => void;
  /** The branch the Add dialog is open for, if any. */
  addTarget: MemoryBranch | null;
  askAdd: (branch: MemoryBranch | null) => void;
  /** Writes a memory by hand, opens its branch and shows it. */
  add: (memory: NewMemory) => Promise<void>;
  open: (spaceId: string) => Promise<void>;
  setRange: (range: MemoryRange) => Promise<void>;
  toggleExpanded: (id: string) => void;
  select: (id: string | null) => void;
  toggleHidden: (key: string) => void;
  resetFilters: () => void;
  /** A refresh the person pressed: the tree shows skeletons until it has reloaded. */
  refresh: () => Promise<void>;
  search: (query: string) => Promise<void>;
  /** Forgets a node and reloads what was listed; counts say what went. */
  forget: (id: string) => Promise<ForgetCounts>;
}

let generation = 0;

const toggled = (set: ReadonlySet<string>, key: string) => {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
};

const initial = {
  children: {},
  expanded: new Set<string>(),
  hidden: new Set<string>(),
  selectedId: null,
  status: "loading" as Status,
  query: "",
  matchIds: new Set<string>(),
  forgetTarget: null,
  addTarget: null as MemoryBranch | null,
};

export const useMemoryTreeStore = create<MemoryTreeState>()((set, get) => {
  const load = async (parent: string, token: number) => {
    const { spaceId, range } = get();
    const nodes = await treeApi.children(spaceId, parent, range);
    if (token === generation) set((s) => ({ children: { ...s.children, [parent]: nodes } }));
  };
  const reloadAll = async (token: number) => {
    await Promise.all(["", ...get().expanded].map((parent) => load(parent, token)));
  };
  const fail = (error: unknown, token: number) => {
    if (token !== generation) return;
    const unavailable = error instanceof ApiRequestError && error.code === "memory_unavailable";
    set({ status: unavailable ? "unavailable" : "error" });
  };

  return {
    ...initial,
    spaceId: "",
    range: "week",
    open: async (spaceId) => {
      const same = get().spaceId === spaceId && get().status === "ready";
      const token = ++generation;
      if (!same) set({ ...initial, spaceId, range: get().range });
      try {
        if (same) await reloadAll(token);
        else {
          await load("", token);
          const first = get().children[""]?.find((n) => n.expandable);
          if (first) {
            set({ expanded: new Set([first.id]) });
            await load(first.id, token);
          }
        }
        if (token === generation) set({ status: "ready" });
      } catch (error) {
        fail(error, token);
      }
    },
    setRange: async (range) => {
      const token = ++generation;
      set({ range });
      try {
        await reloadAll(token);
      } catch (error) {
        fail(error, token);
      }
    },
    toggleExpanded: (id) => {
      const opening = !get().expanded.has(id);
      set((s) => ({ expanded: toggled(s.expanded, id) }));
      if (opening && !get().children[id]) {
        const token = generation;
        void load(id, token).catch((error) => fail(error, token));
      }
    },
    select: (selectedId) => set({ selectedId }),
    askForget: (forgetTarget) => set({ forgetTarget }),
    askAdd: (addTarget) => set({ addTarget }),
    add: async (memory) => {
      const { id } = await treeApi.add(get().spaceId, memory);
      const group = memory.branch === "moments" ? "moments:kind:note" : null;
      const token = ++generation;
      // Show it: open its branch, and the notes group, and lift any filter that hides them.
      set((s) => {
        const hidden = new Set(s.hidden);
        for (const key of [memory.branch, "source:note", group ?? ""]) hidden.delete(key);
        return {
          hidden,
          expanded: new Set([...s.expanded, memory.branch, ...(group ? [group] : [])]),
        };
      });
      await reloadAll(token).catch((error) => fail(error, token));
      // After the nodes have glided into place, so its popover opens beside it.
      window.setTimeout(() => set({ selectedId: id }), 700);
    },
    toggleHidden: (key) => set((s) => ({ hidden: toggled(s.hidden, key) })),
    resetFilters: () => set({ hidden: new Set() }),
    refresh: async () => {
      const token = ++generation;
      set({ status: "loading" });
      try {
        await reloadAll(token);
        if (token === generation) set({ status: "ready" });
      } catch (error) {
        fail(error, token);
      }
    },
    search: async (query) => {
      const text = query.trim();
      if (!text) {
        set({ query: "", matchIds: new Set() });
        return;
      }
      set({ query: text });
      try {
        const { events } = await memoryApi.events({ q: text, limit: 20 });
        if (get().query !== text) return;
        const groups = new Set(events.map(momentGroupId));
        set((s) => ({
          matchIds: new Set(events.map((e) => `moment:${e.id}`)),
          expanded: new Set([...s.expanded, "moments", ...groups]),
        }));
        const token = generation;
        await Promise.all(
          ["moments", ...groups].filter((id) => !get().children[id]).map((id) => load(id, token)),
        );
      } catch (error) {
        fail(error, generation);
      }
    },
    forget: async (id) => {
      const { spaceId, range } = get();
      const { counts } = await treeApi.forget(spaceId, id, range, false);
      const token = ++generation;
      set((s) => ({ selectedId: s.selectedId === id ? null : s.selectedId }));
      await reloadAll(token).catch((error) => fail(error, token));
      return counts;
    },
  };
});
