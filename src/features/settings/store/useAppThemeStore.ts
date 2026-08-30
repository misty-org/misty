import { create } from "zustand";

/**
 * Misty ships one theme. This store exists because canvas surfaces (drawings,
 * roadmap, note editor) need to read a resolved theme at render time rather
 * than from CSS. It is deliberately not a preference: there is no light
 * palette to switch to, so no settings control writes here.
 */
export const useAppThemeStore = create<AppThemeStore>()(() => ({
  resolvedTheme: "dark",
}));

export type ResolvedAppTheme = "dark";

export type AppThemeStore = {
  resolvedTheme: ResolvedAppTheme;
};
