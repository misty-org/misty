import { create } from "zustand";
import { createDeviceSetting } from "@/shared/lib/device_setting";

export const MISTY_PANEL_WIDTH = 400;
export const MISTY_PANEL_MIN_WIDTH = 360;
export const MISTY_PANEL_MAX_WIDTH = 720;

const clampMistyPanelWidth = (width: number) =>
  Math.round(Math.max(MISTY_PANEL_MIN_WIDTH, Math.min(MISTY_PANEL_MAX_WIDTH, width)));

interface SavedMistyPanel {
  chatOpen: boolean;
  width: number;
}

const savedDefaults: SavedMistyPanel = { chatOpen: false, width: MISTY_PANEL_WIDTH };

const savedPanel = createDeviceSetting<SavedMistyPanel>({
  scope: "misty-panel",
  defaults: savedDefaults,
  legacyKey: "misty:misty-panel-width",
  normalize: (stored) => {
    if (typeof stored === "number" || typeof stored === "string") {
      const width = Number(stored);
      return { ...savedDefaults, width: width ? clampMistyPanelWidth(width) : MISTY_PANEL_WIDTH };
    }
    const saved = (stored ?? {}) as Partial<SavedMistyPanel>;
    return {
      chatOpen: saved.chatOpen === true,
      width:
        typeof saved.width === "number" && saved.width
          ? clampMistyPanelWidth(saved.width)
          : MISTY_PANEL_WIDTH,
    };
  },
});

export type MistyPanelView = "chat";

interface MistyPanelState {
  chatOpen: boolean;
  width: number;
  toggle(): void;
  close(): void;
  setWidth(width: number): void;
}

export const useMistyPanelStore = create<MistyPanelState>((set, get) => {
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    if (!openRestored) touchedEarly = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const { chatOpen, width } = get();
      savedPanel.getState().set({ chatOpen, width });
    }, 250);
  };
  return {
    chatOpen: savedPanel.getState().value.chatOpen,
    width: savedPanel.getState().value.width,
    toggle: () => {
      set((state) => ({ chatOpen: !state.chatOpen }));
      save();
    },
    close: () => {
      set({ chatOpen: false });
      save();
    },
    setWidth: (width) => {
      set({ width: clampMistyPanelWidth(width) });
      save();
    },
  };
});

let openRestored = false;
let touchedEarly = false;
savedPanel.subscribe((state) => {
  if (!state.loaded) return;
  const first = !openRestored;
  openRestored = true;
  if (first && !touchedEarly) useMistyPanelStore.setState(state.value);
  else if (!first) useMistyPanelStore.setState({ width: state.value.width });
});
