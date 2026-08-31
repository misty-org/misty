import { create } from "zustand";

/**
 * Canvas surfaces read the resolved mode at render time rather than from CSS.
 * The Themes extension updates this alongside the semantic CSS token set.
 */
export const useAppThemeStore = create<AppThemeStore>()((set) => ({
  resolvedTheme: "dark",
  setResolvedTheme: (resolvedTheme) => set({ resolvedTheme }),
}));

export type ResolvedAppTheme = "dark" | "light";

export type AppThemeStore = {
  resolvedTheme: ResolvedAppTheme;
  setResolvedTheme: (resolvedTheme: ResolvedAppTheme) => void;
};
