/**
 * The UI's sizes are written in design pixels (a 32px row, a 280px sidebar) and drawn in rem, so
 * they grow with the root: 110% in the main window (src/styles/App.css), 100% in the overlay
 * windows. Lengths kept in JS go through these so they stay in step with the CSS beside them.
 */

/** A design length as CSS, in rem, for a style or a custom property. */
export function remCss(px: number): string {
  return `${px / 16}rem`;
}

/** How many CSS pixels one design pixel is: the root's font size over the browser's 16px. */
export function uiScale(): number {
  if (typeof document === "undefined") return 1;
  const size = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return size > 0 ? size / 16 : 1;
}

/** A design length in CSS pixels, for math beside measured boxes and pointer positions. */
export function uiPx(px: number): number {
  return px * uiScale();
}

/** A measured length in CSS pixels back in design pixels, for a size that is saved. */
export function designPx(cssPx: number): number {
  return cssPx / uiScale();
}

/** A length from a custom property ("12px" or "0.75rem"), in CSS pixels; custom properties come back as written. */
export function cssLengthPx(value: string): number {
  const length = Number.parseFloat(value);
  if (!Number.isFinite(length)) return 0;
  return value.trim().endsWith("rem") ? length * 16 * uiScale() : length;
}
