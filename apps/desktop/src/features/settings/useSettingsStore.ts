import { create } from "zustand";
import { settingsSave, settingsSnapshot, shortcutsSave, shortcutsSnapshot } from "../../api/misty";
import type { ShortcutsSnapshot, SettingsSnapshot } from "../../api/types";
import { errorText } from "../../shared/format";

interface SettingsStore {
  settings: SettingsSnapshot | null;
  settingsText: string;
  shortcuts: ShortcutsSnapshot | null;
  working: boolean;
  error: string | null;
  message: string | null;
  load: () => Promise<void>;
  setSettingsText: (value: string) => void;
  saveSettingsDocument: () => Promise<void>;
  setShortcut: (commandId: string, shortcut: string) => void;
  saveShortcuts: () => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: null,
  settingsText: "{}",
  shortcuts: null,
  working: false,
  error: null,
  message: null,

  load: async () => {
    set({ working: true, error: null });
    try {
      const [settings, shortcuts] = await Promise.all([settingsSnapshot(), shortcutsSnapshot()]);
      set({
        settings,
        settingsText: JSON.stringify(settings.document, null, 2),
        shortcuts,
      });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  setSettingsText: (settingsText) => set({ settingsText }),

  saveSettingsDocument: async () => {
    set({ working: true, error: null, message: null });
    try {
      const parsed = JSON.parse(get().settingsText) as unknown;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error("Settings must be a JSON object.");
      }
      const settings = await settingsSave({ document: parsed as Record<string, unknown> });
      set({
        settings,
        settingsText: JSON.stringify(settings.document, null, 2),
        message: "Settings saved.",
      });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  setShortcut: (commandId, shortcut) => {
    set((state) => {
      if (!state.shortcuts) return state;
      return {
        shortcuts: {
          ...state.shortcuts,
          bindings: state.shortcuts.bindings.map((binding) =>
            binding.commandId === commandId ? { ...binding, shortcut, source: "user" } : binding,
          ),
        },
      };
    });
  },

  saveShortcuts: async () => {
    const { shortcuts } = get();
    if (!shortcuts) return;
    set({ working: true, error: null, message: null });
    try {
      set({
        shortcuts: await shortcutsSave({ bindings: shortcuts.bindings }),
        message: "Shortcuts saved.",
      });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },
}));
