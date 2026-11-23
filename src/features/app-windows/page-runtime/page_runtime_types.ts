export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  cornerRadii?: [number, number, number, number];
  cornerColor?: string;
}

export type BrowserTheme = "dark" | "light" | "system";
