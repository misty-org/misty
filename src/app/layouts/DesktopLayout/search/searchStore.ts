import { create } from "zustand";
import { readDeviceState, updateDeviceState } from "@/features/agents";

/** Whether ⌘K search is open, and the words it opens with. The sidebar row and ⌘K both set it. */
export const useSearchDialog = create<{
  open: boolean;
  initial: string;
  setOpen(open: boolean, initial?: string): void;
}>((set) => ({
  open: false,
  initial: "",
  setOpen: (open, initial = "") => set({ open, initial }),
}));

type Uses = Record<string, { count: number; last: number }>;
const scope = "search-uses";
/** Enough to rank what a person opens often; the oldest go first past it. */
const kept = 300;

/**
 * How often each result was opened from search on this device, kept in `misty.db`, so what a
 * person opens often ranks higher next time.
 */
export const useSearchUses = create<{
  uses: Uses;
  loaded: boolean;
  load(): Promise<void>;
  note(id: string): void;
}>((set, get) => ({
  uses: {},
  loaded: false,
  async load() {
    if (get().loaded) return;
    try {
      set({ uses: (await readDeviceState<Uses>(scope)) ?? {}, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  note(id) {
    const bump = (uses: Uses): Uses => {
      const next = { ...uses, [id]: { count: (uses[id]?.count ?? 0) + 1, last: Date.now() } };
      const ids = Object.keys(next);
      if (ids.length <= kept) return next;
      ids.sort((a, b) => next[b].last - next[a].last);
      return Object.fromEntries(ids.slice(0, kept).map((key) => [key, next[key]]));
    };
    set({ uses: bump(get().uses) });
    void updateDeviceState<Uses>(scope, () => ({}), bump).catch(() => undefined);
  },
}));
