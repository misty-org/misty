import { create } from "zustand";
import { readDeviceState, updateDeviceState } from "@/features/agents";
import { announceDeviceSetting, onDeviceSettingChange } from "@/shared/lib/device_setting";
import type { TourId } from "./tours";

interface ToursState {
  seen: TourId[];
}

const scope = "tours";
const empty: ToursState = { seen: [] };

export const startTourEvent = "misty:start-tour";
export function startTour(id: TourId | "here" = "here") {
  window.dispatchEvent(new CustomEvent(startTourEvent, { detail: id }));
}

export const useTours = create<
  ToursState & {
    loaded: boolean;
    active: TourId | null;
    load(): Promise<void>;
    open(id: TourId): void;
    close(): void;
  }
>((set, get) => {
  let saving = 0;
  let saveEvents = 0;
  const save = (change: (state: ToursState) => ToursState) => {
    set(change({ seen: get().seen }));
    saving++;
    saveEvents++;
    void updateDeviceState<ToursState>(scope, () => empty, change)
      .then(() => announceDeviceSetting(scope))
      .catch(() => undefined)
      .finally(() => {
        saving--;
        saveEvents++;
        if (!saving) void get().load();
      });
  };
  return {
    ...empty,
    loaded: false,
    active: null,
    async load() {
      const started = saveEvents;
      try {
        const stored = await readDeviceState<Partial<ToursState>>(scope);
        if (saving || saveEvents !== started) return;
        set({
          seen: stored?.seen ?? [],
          loaded: true,
        });
      } catch {
        set({ seen: [], loaded: false });
      }
    },
    open(id) {
      if (!get().active) set({ active: id });
    },
    close() {
      const id = get().active;
      set({ active: null });
      if (id && !get().seen.includes(id))
        save((state) => ({ ...state, seen: [...new Set([...state.seen, id])] }));
    },
  };
});

onDeviceSettingChange(scope, () => void useTours.getState().load());
