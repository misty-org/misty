/**
 * The color a virtual window carries, so windows are easy to tell apart. It tints the
 * window's chrome (frame, navigator and tab strip), never its content. The hues match
 * the tab group palette, without gray: gray would not tell windows apart.
 */
export const windowColors = {
  blue: "#8ab4f8",
  red: "#f28b82",
  yellow: "#fdd663",
  green: "#81c995",
  pink: "#ff8bcb",
  purple: "#c58af9",
  cyan: "#78d9ec",
  orange: "#fcad70",
} as const;
export type PaletteWindowColor = keyof typeof windowColors;
/** A palette name, or a custom color as `#rrggbb`. */
export type WindowColor = PaletteWindowColor | `#${string}`;
export const windowColorNames = Object.keys(windowColors) as PaletteWindowColor[];

export function isWindowColor(value: unknown): value is WindowColor {
  return (
    typeof value === "string" &&
    (Object.prototype.hasOwnProperty.call(windowColors, value) || /^#[0-9a-f]{6}$/.test(value))
  );
}

/** The CSS color for a window color. */
export function windowColorHex(color: WindowColor): string {
  return color.startsWith("#") ? color : windowColors[color as PaletteWindowColor];
}

/** The chrome background for a window color: a quiet wash over the theme's own surface. */
export function windowChromeBackground(color: WindowColor | undefined): string | undefined {
  return color
    ? `color-mix(in srgb, ${windowColorHex(color)} 16%, var(--misty-theme-workspace))`
    : undefined;
}
