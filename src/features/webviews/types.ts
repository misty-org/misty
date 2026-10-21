export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Top-left, top-right, bottom-right and bottom-left radii where the page
   * meets a rounded workspace corner. */
  cornerRadii?: [number, number, number, number];
  /** The window chrome around those corners (`#rrggbb`), which smooths their edge on Windows. */
  cornerColor?: string;
}

export type BrowserTheme = "dark" | "light" | "system";
