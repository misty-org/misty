import { create } from "zustand";
import { readDeviceState, updateDeviceState } from "@/features/agents";
import { announceDeviceSetting, onDeviceSettingChange } from "@/shared/lib/deviceSetting";

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

// Saves still in flight, and a count bumped as each starts and ends, so a read that raced a
// save is dropped rather than showing the counts as they were before it.
let saving = 0;
let saveEvents = 0;

/** Reads the counts from `misty.db`, unless a save began or ended while reading. */
async function readUses() {
  const started = saveEvents;
  try {
    const uses = (await readDeviceState<Uses>(scope)) ?? {};
    if (saving || saveEvents !== started) return;
    useSearchUses.setState({ uses, loaded: true });
  } catch {
    useSearchUses.setState({ loaded: true });
  }
}

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
    if (!get().loaded) await readUses();
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
    saving++;
    saveEvents++;
    void updateDeviceState<Uses>(scope, () => ({}), bump)
      .then(() => announceDeviceSetting(scope))
      .catch(() => undefined)
      .finally(() => {
        saving--;
        saveEvents++;
        // Read back once the saves settle: a failed one drops out of memory, and a change
        // another window announced meanwhile shows up.
        if (!saving) void readUses();
      });
  },
}));

onDeviceSettingChange(scope, () => void readUses());
