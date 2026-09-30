import type { BrowserTheme } from "./types";
export function browserThemeFromDocument(): BrowserTheme {
  const theme = document.documentElement.dataset.theme;
  if (theme === "light" || theme === "dark") return theme;
  return typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}
