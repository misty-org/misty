import { create } from "zustand";
import { readDeviceState, updateDeviceState } from "@/features/agents";
import { announceDeviceSetting, onDeviceSettingChange } from "@/shared/lib/deviceSetting";
import type { TourId } from "./tours";

/** What this device remembers about showing someone around, in `misty.db`. It never syncs. */
interface ToursState {
  /** Tours shown here, finished or skipped: each opens by itself only once. */
  seen: TourId[];
  /** The Getting started list on a Space's home was put away. */
  checklistHidden: boolean;
}

const scope = "tours";
const empty: ToursState = { seen: [], checklistHidden: false };

/** Asks the window's tour host to show a tour now; "here" is the tour for the page in view. */
export const startTourEvent = "misty:start-tour";
export function startTour(id: TourId | "here" = "here") {
  window.dispatchEvent(new CustomEvent(startTourEvent, { detail: id }));
}

export const useTours = create<
  ToursState & {
    loaded: boolean;
    /** The tour on screen, if any. */
    active: TourId | null;
    load(): Promise<void>;
    open(id: TourId): void;
    /** The tour on screen ended, finished or skipped; either way it counts as seen. */
    close(): void;
    hideChecklist(): void;
  }
>((set, get) => {
  // Saves still in flight, and a count bumped as each starts and ends, so a read that raced
  // a save is dropped rather than showing the device as it was before it.
  let saving = 0;
  let saveEvents = 0;
  const save = (change: (state: ToursState) => ToursState) => {
    set(change({ seen: get().seen, checklistHidden: get().checklistHidden }));
    saving++;
    saveEvents++;
    void updateDeviceState<ToursState>(scope, () => empty, change)
      .then(() => announceDeviceSetting(scope))
      .catch(() => undefined)
      .finally(() => {
        saving--;
        saveEvents++;
        // Read back once the saves settle: a failed one drops out of memory, and a change
        // another window announced meanwhile shows up.
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
          checklistHidden: stored?.checklistHidden ?? false,
          loaded: true,
        });
      } catch {
        // Unreadable: show nothing by itself, so a broken store never nags.
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
    hideChecklist() {
      save((state) => ({ ...state, checklistHidden: true }));
    },
  };
});

onDeviceSettingChange(scope, () => void useTours.getState().load());
