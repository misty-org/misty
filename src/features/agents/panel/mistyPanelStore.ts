import { create } from "zustand";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";

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

/**
 * Whether the panel was open and how wide, kept for the device in misty.db so both survive a
 * restart. Earlier versions kept only the width, as a bare number in webview storage.
 */
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

/** The side panel: your Space's chat with people. */
export type MistyPanelView = "chat";

interface MistyPanelState {
  /** The chat panel is open. */
  chatOpen: boolean;
  /** The panel's width. */
  width: number;
  /** The shortcut: opens the chat panel, or closes it when it is open. */
  toggle(): void;
  /** Closes the panel, as its close button and dragging it shut do. */
  close(): void;
  /** Sets the panel's width. */
  setWidth(width: number): void;
}

/** The side panel: open only when asked, by its shortcut, and as it was left. */
export const useMistyPanelStore = create<MistyPanelState>((set, get) => {
  // A drag sets the width on every move, so it is saved once the drag rests.
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    // A choice made before misty.db first answers wins over that first answer.
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

// misty.db answers after the first frame. Whether the panel is open is taken only from that first
// answer, so opening it in one window does not open it in the others; the width follows them all.
let openRestored = false;
let touchedEarly = false;
savedPanel.subscribe((state) => {
  if (!state.loaded) return;
  const first = !openRestored;
  openRestored = true;
  if (first && !touchedEarly) useMistyPanelStore.setState(state.value);
  else if (!first) useMistyPanelStore.setState({ width: state.value.width });
});
