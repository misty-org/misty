import { create } from "zustand";

const storageKey = "misty:last-space:v1";

function read(): string {
  try {
    return window.localStorage.getItem(storageKey) ?? "";
  } catch {
    return "";
  }
}

/** The Space opened last, so the Spaces button keeps naming it on pages that aren't a Space.
 * The choice stays on this device. */
export const useLastSpaceStore = create<{ id: string; remember(id: string): void }>((set, get) => ({
  id: read(),
  remember: (id) => {
    if (!id || id === get().id) return;
    set({ id });
    try {
      window.localStorage.setItem(storageKey, id);
    } catch {
      /* The choice still applies for this session. */
    }
  },
}));
