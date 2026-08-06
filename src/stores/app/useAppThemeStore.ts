import { create } from "zustand";

export function settingsIndexToThemeMode(_index: number): AppThemeMode {
  return "dark";
}

export const useAppThemeStore = create<AppThemeStore>()((set) => ({
  resolvedTheme: "dark",
  themeMode: "dark",
  setThemeMode: () => set({ themeMode: "dark", resolvedTheme: "dark" }),
}));

export type AppThemeMode = "dark";

export type ResolvedAppTheme = "dark";

export type AppThemeStore = {
  resolvedTheme: ResolvedAppTheme;
  themeMode: AppThemeMode;
  setThemeMode: (mode: AppThemeMode) => void;
};
