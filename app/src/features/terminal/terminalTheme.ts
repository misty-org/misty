import type { ISearchOptions } from "@xterm/addon-search";
import type { ITheme } from "@xterm/xterm";

// Misty charcoal/cream mapped to xterm's 16-color palette + defaults. Kept in
// this file rather than a theme file so any surface embedding TerminalPane
// gets the exact same shell colors for free.
export const MISTY_TERMINAL_THEME: ITheme = {
  background: "#111312",
  foreground: "#e9e8e2",
  cursor: "#e8d9c0",
  cursorAccent: "#111312",
  selectionBackground: "#3a3a34",
  selectionForeground: "#f1f1f1",
  black: "#171918",
  brightBlack: "#5f5f5a",
  red: "#d68b80",
  brightRed: "#efab9f",
  green: "#a8c090",
  brightGreen: "#c5e89e",
  yellow: "#d4b880",
  brightYellow: "#e7cf94",
  blue: "#87a9c7",
  brightBlue: "#a9c7e2",
  magenta: "#c5a3d8",
  brightMagenta: "#d9beea",
  cyan: "#87c2c7",
  brightCyan: "#a9d9de",
  white: "#e0e0e0",
  brightWhite: "#f1f1f1",
};

/** xterm search decorations require literal colors, so keep them beside the
 * terminal palette instead of introducing one-off values in the component. */
export const MISTY_TERMINAL_SEARCH_DECORATIONS: NonNullable<ISearchOptions["decorations"]> = {
  matchBackground: "#3e3e3e",
  matchBorder: "#8c8c8c",
  matchOverviewRuler: "#8c8c8c",
  activeMatchBackground: "#d4b880",
  activeMatchBorder: "#f1f1f1",
  activeMatchColorOverviewRuler: "#d4b880",
};
