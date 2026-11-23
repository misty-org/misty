import { create } from "zustand";

export const useAppThemeStore = create<AppThemeStore>()((set) => ({
  resolvedTheme: "dark",
  setResolvedTheme: (resolvedTheme) => set({ resolvedTheme }),
}));

export type ResolvedAppTheme = "dark" | "light";

type AppThemeStore = {
  resolvedTheme: ResolvedAppTheme;
  setResolvedTheme: (resolvedTheme: ResolvedAppTheme) => void;
};
