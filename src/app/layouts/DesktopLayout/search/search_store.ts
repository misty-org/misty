import { create } from "zustand";
import { readDeviceState, updateDeviceState } from "@/features/agents";
import { announceDeviceSetting, onDeviceSettingChange } from "@/shared/lib/device_setting";
import type { SearchScope } from "@/shared/lib/scoped_search";

export const useSearchDialog = create<{
  open: boolean;
  initial: string;
  scope: SearchScope | null;
  setOpen(open: boolean, initial?: string): void;
  openScoped(scope: SearchScope): void;
  clearScope(): void;
}>((set) => ({
  open: false,
  initial: "",
  scope: null,
  setOpen: (open, initial = "") => set({ open, initial, scope: null }),
  openScoped: (scope) => set({ open: true, initial: "", scope }),
  clearScope: () => set({ scope: null }),
}));

type Uses = Record<string, { count: number; last: number }>;
const scope = "search-uses";
const kept = 300;

let saving = 0;
let saveEvents = 0;

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
        if (!saving) void readUses();
      });
  },
}));

onDeviceSettingChange(scope, () => void readUses());
