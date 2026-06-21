import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type AppThemeMode = "system" | "dark" | "light";
export type ResolvedAppTheme = "dark" | "light";

type AppThemeStore = {
  resolvedTheme: ResolvedAppTheme;
  systemTheme: ResolvedAppTheme;
  themeMode: AppThemeMode;
  setSystemTheme: (theme: ResolvedAppTheme) => void;
  setThemeMode: (mode: AppThemeMode) => void;
};

const THEME_STORAGE_KEY = "misty:app-theme";

function resolveTheme(mode: AppThemeMode, systemTheme: ResolvedAppTheme): ResolvedAppTheme {
  return mode === "system" ? systemTheme : mode;
}

export function settingsIndexToThemeMode(index: number): AppThemeMode {
  if (index === 1) return "dark";
  if (index === 2) return "light";
  return "system";
}

export function themeModeToSettingsIndex(mode: AppThemeMode): number {
  if (mode === "dark") return 1;
  if (mode === "light") return 2;
  return 0;
}

function safeThemeMode(value: unknown): AppThemeMode {
  return value === "dark" || value === "light" || value === "system" ? value : "system";
}

export const useAppThemeStore = create<AppThemeStore>()(
  persist(
    (set, get) => ({
      resolvedTheme: "dark",
      systemTheme: "dark",
      themeMode: "system",
      setSystemTheme: (systemTheme) => {
        set({
          systemTheme,
          resolvedTheme: resolveTheme(get().themeMode, systemTheme),
        });
      },
      setThemeMode: (themeMode) => {
        set({
          themeMode,
          resolvedTheme: resolveTheme(themeMode, get().systemTheme),
        });
      },
    }),
    {
      name: THEME_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ themeMode: state.themeMode }),
      merge: (persisted, current) => {
        const themeMode =
          persisted && typeof persisted === "object" && "themeMode" in persisted
            ? safeThemeMode(persisted.themeMode)
            : current.themeMode;
        return {
          ...current,
          themeMode,
          resolvedTheme: resolveTheme(themeMode, current.systemTheme),
        };
      },
    },
  ),
);
