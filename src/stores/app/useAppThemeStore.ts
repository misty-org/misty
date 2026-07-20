import type {
  AppThemeMode,
  ResolvedAppTheme,
  MistyThemeId,
  MistyCustomThemeTokens,
  AppThemeStore,
} from "@/models/types/stores/app/useAppThemeStore";
export type {
  AppThemeMode,
  ResolvedAppTheme,
  MistyThemeId,
  MistyCustomThemeTokens,
  AppThemeStore,
} from "@/models/types/stores/app/useAppThemeStore";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

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

function safeThemeId(value: unknown): MistyThemeId {
  return value === "misty-light" ||
    value === "graphite" ||
    value === "aurora" ||
    value === "copper" ||
    value === "misty-dark"
    ? value
    : "misty-dark";
}

export function themeBaseMode(themeId: MistyThemeId): ResolvedAppTheme {
  return themeId === "misty-light" ? "light" : "dark";
}

export function themeIdForExtensionAction(actionId: string): MistyThemeId | null {
  switch (actionId) {
    case "apply_light":
      return "misty-light";
    case "apply_graphite":
      return "graphite";
    case "apply_aurora":
      return "aurora";
    case "apply_copper":
      return "copper";
    case "apply_dark":
      return "misty-dark";
    default:
      return null;
  }
}

export function applyMistyThemeFromExtensionAction(actionId: string): boolean {
  const themeId = themeIdForExtensionAction(actionId);
  if (!themeId) return false;
  const store = useAppThemeStore.getState();
  store.setThemeMode(themeBaseMode(themeId));
  store.setThemeId(themeId);
  return true;
}

export const useAppThemeStore = create<AppThemeStore>()(
  persist(
    (set, get) => ({
      customTokens: null,
      resolvedTheme: "dark",
      systemTheme: "dark",
      themeId: "misty-dark",
      themeMode: "system",
      setSystemTheme: (systemTheme) => {
        const resolvedTheme = resolveTheme(get().themeMode, systemTheme);
        set({
          themeId:
            get().themeMode === "system"
              ? resolvedTheme === "light"
                ? "misty-light"
                : "misty-dark"
              : get().themeId,
          systemTheme,
          resolvedTheme,
        });
      },
      setThemeMode: (themeMode) => {
        const resolvedTheme = resolveTheme(themeMode, get().systemTheme);
        set({
          customTokens: null,
          themeId: resolvedTheme === "light" ? "misty-light" : "misty-dark",
          themeMode,
          resolvedTheme,
        });
      },
      setThemeId: (themeId) => {
        set({ themeId, customTokens: null });
      },
      setCustomTokens: (customTokens) => set({ customTokens }),
    }),
    {
      name: THEME_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        customTokens: state.customTokens,
        themeMode: state.themeMode,
        themeId: state.themeId,
      }),
      merge: (persisted, current) => {
        const themeMode =
          persisted && typeof persisted === "object" && "themeMode" in persisted
            ? safeThemeMode(persisted.themeMode)
            : current.themeMode;
        const themeId =
          persisted && typeof persisted === "object" && "themeId" in persisted
            ? safeThemeId(persisted.themeId)
            : current.themeId;
        const customTokens =
          persisted &&
          typeof persisted === "object" &&
          "customTokens" in persisted &&
          persisted.customTokens &&
          typeof persisted.customTokens === "object"
            ? (persisted.customTokens as MistyCustomThemeTokens)
            : null;
        return {
          ...current,
          customTokens,
          themeId,
          themeMode,
          resolvedTheme: resolveTheme(themeMode, current.systemTheme),
        };
      },
    },
  ),
);
