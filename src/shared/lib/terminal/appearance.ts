// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import type { ITheme } from "@xterm/xterm";

export const TERMINAL_FONT_SIZE = 12.5;
export const DEFAULT_MONO_STACK =
  'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';

/** The live `--font-mono` stack as the browser resolves it, or "" where it can't be read. */
export function computedMonoFontStack(): string {
  if (typeof window === "undefined" || typeof document === "undefined") return "";
  try {
    return getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
  } catch {
    return "";
  }
}

/** The terminal's face: the window's code font, so the terminal matches code everywhere else. */
export function terminalFontFamily(): string {
  return computedMonoFontStack() || DEFAULT_MONO_STACK;
}

/** xterm reads only hex and rgb() colors; anything else (color-mix, oklch) is passed over. */
function xtermColor(value: string): string | undefined {
  const color = value.trim();
  return /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) || /^rgba?\(/i.test(color)
    ? color
    : undefined;
}

function themeVariable(name: string): string | undefined {
  try {
    return xtermColor(getComputedStyle(document.documentElement).getPropertyValue(name));
  } catch {
    return undefined;
  }
}

/**
 * The terminal's colors. The background and text follow the window's theme, read from its CSS
 * variables, so the terminal sits in the panel like the rest of it; the sixteen ANSI colors
 * follow VS Code's dark and light palettes, picked by the window's `dark` class.
 */
export function terminalTheme(): ITheme {
  const dark = document.documentElement.classList.contains("dark");
  const background = themeVariable("--misty-theme-card") ?? (dark ? "#191919" : "#ffffff");
  const foreground = themeVariable("--misty-theme-text") ?? (dark ? "#e0e0e0" : "#1f2328");
  if (dark) {
    return {
      background,
      foreground,
      cursor: foreground,
      selectionBackground: "rgba(255, 255, 255, 0.22)",
      black: "#000000",
      red: "#cd3131",
      green: "#0dbc79",
      yellow: "#e5e510",
      blue: "#2472c8",
      magenta: "#bc3fbc",
      cyan: "#11a8cd",
      white: "#e5e5e5",
      brightBlack: "#666666",
      brightRed: "#f14c4c",
      brightGreen: "#23d18b",
      brightYellow: "#f5f543",
      brightBlue: "#3b8eea",
      brightMagenta: "#d670d6",
      brightCyan: "#29b8db",
      brightWhite: "#ffffff",
    };
  }
  return {
    background,
    foreground,
    cursor: foreground,
    selectionBackground: "rgba(0, 0, 0, 0.16)",
    black: "#000000",
    red: "#cd3131",
    green: "#00bc00",
    yellow: "#9a6700",
    blue: "#0451a5",
    magenta: "#bc05bc",
    cyan: "#0598bc",
    white: "#555555",
    brightBlack: "#666666",
    brightRed: "#cd3131",
    brightGreen: "#14ce14",
    brightYellow: "#7d5500",
    brightBlue: "#0451a5",
    brightMagenta: "#bc05bc",
    brightCyan: "#0598bc",
    brightWhite: "#a5a5a5",
  };
}
