import type { Source } from "./spaceAppHandlers";

export interface AppTheme {
  mode: "light" | "dark";
  tokens: Record<string, string>;
  fonts: { sans: string; mono: string };
}

/** The tokens an app on the SDK gets, as `misty-theme.css` names them. */
const tokenNames = [
  "--misty-theme-bg",
  "--misty-theme-sidebar",
  "--misty-theme-card",
  "--misty-theme-border",
  "--misty-theme-border-strong",
  "--misty-theme-hover",
  "--misty-theme-active",
  "--misty-theme-text",
  "--misty-theme-text-bright",
  "--misty-theme-text-muted",
  "--misty-theme-danger",
  "--hairline",
];

export function readTheme(root: HTMLElement = document.documentElement): AppTheme {
  const style = getComputedStyle(root);
  const tokens: Record<string, string> = {};
  for (const name of tokenNames) {
    const value = style.getPropertyValue(name).trim();
    if (value) tokens[name] = value;
  }
  return {
    mode: root.dataset.themeMode === "light" ? "light" : "dark",
    tokens,
    fonts: {
      sans: style.getPropertyValue("--font-sans").trim() || "Inter, system-ui, sans-serif",
      mono: style.getPropertyValue("--font-mono").trim() || "ui-monospace, Menlo, monospace",
    },
  };
}

/** The theme as it is now and every time the app's theme changes the document's tokens. */
export const themeSource: Source<AppTheme> = {
  get: () => readTheme(),
  subscribe(listener) {
    const observer = new MutationObserver(() => listener(readTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "data-theme-mode"],
    });
    return () => observer.disconnect();
  },
};
