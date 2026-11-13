import { create } from "zustand";
import { readDeviceState, updateDeviceState } from "@/features/agents";
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
  const save = (change: (state: ToursState) => ToursState) => {
    set(change({ seen: get().seen, checklistHidden: get().checklistHidden }));
    void updateDeviceState<ToursState>(scope, () => empty, change).catch(() => undefined);
  };
  return {
    ...empty,
    loaded: false,
    active: null,
    async load() {
      try {
        const stored = await readDeviceState<Partial<ToursState>>(scope);
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
