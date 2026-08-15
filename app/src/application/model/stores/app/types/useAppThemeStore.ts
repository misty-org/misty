export type AppThemeMode = "system" | "dark" | "light";

export type ResolvedAppTheme = "dark" | "light";

export type MistyThemeId = "misty-dark" | "misty-light" | "graphite" | "aurora" | "copper";

export type MistyCustomThemeTokens = Partial<
  Record<
    | "background"
    | "surface"
    | "foreground"
    | "muted"
    | "accent"
    | "selection"
    | "success"
    | "warning"
    | "danger",
    string
  >
>;

export type AppThemeStore = {
  customTokens: MistyCustomThemeTokens | null;
  resolvedTheme: ResolvedAppTheme;
  systemTheme: ResolvedAppTheme;
  themeId: MistyThemeId;
  themeMode: AppThemeMode;
  setSystemTheme: (theme: ResolvedAppTheme) => void;
  setThemeId: (themeId: MistyThemeId) => void;
  setThemeMode: (mode: AppThemeMode) => void;
  setCustomTokens: (tokens: MistyCustomThemeTokens | null) => void;
};
