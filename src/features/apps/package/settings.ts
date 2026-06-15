import { create } from "zustand";

export * from "@/features/settings/store/extensionTheme";
export * from "@/features/settings/store/useAppThemeStore";
export * from "@/features/settings/store/preferences";

type PackageSettingsDocument = Record<string, unknown>;

interface PackageSettingsState {
  settings: { path: string; document: PackageSettingsDocument } | null;
  shortcuts: null;
  loaded: boolean;
  working: boolean;
  updateSetting: (section: string, key: string, value: unknown) => void;
}

export const useSettingsStore = create<PackageSettingsState>((set) => ({
  settings: { path: "", document: {} },
  shortcuts: null,
  loaded: true,
  working: false,
  updateSetting: (section, key, value) =>
    set((state) => {
      const document = { ...(state.settings?.document ?? {}) };
      const current = document[section];
      document[section] =
        current && typeof current === "object" && !Array.isArray(current)
          ? { ...(current as Record<string, unknown>), [key]: value }
          : { [key]: value };
      return { settings: { path: "", document } };
    }),
}));

export function configureOfficialAppSettings(document: PackageSettingsDocument) {
  if (useSettingsStore.getState().settings?.document === document) return;
  useSettingsStore.setState({ settings: { path: "", document }, loaded: true });
}
