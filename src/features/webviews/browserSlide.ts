/**
 * While a panel above the page slides (the Space bar growing or shrinking), the page keeps the
 * size it has when the panel is tucked away and only its top edge moves. The part that hangs
 * below the window is clipped by the window itself, so the page looks resized from the top
 * while its contents never relayout or leave an unpainted strip at the bottom; it takes its
 * true size once the slide has ended.
 */
let slidingRow: HTMLElement | null = null;

/** The root carries this while a slide runs, so the page host paints the chrome color (theme.css):
 * the native page follows the bar a frame behind, and the gap between them would otherwise show
 * the window straight through the transparent host as a black strip. */
const slideAttribute = "data-browser-slide";

export function beginBrowserSlide(row: HTMLElement | null): void {
  slidingRow = row;
  if (typeof document !== "undefined") document.documentElement.setAttribute(slideAttribute, "");
}

export function endBrowserSlide(): void {
  slidingRow = null;
  if (typeof document !== "undefined") document.documentElement.removeAttribute(slideAttribute);
}

export function browserSlideActive(): boolean {
  return slidingRow !== null;
}

/** How far the page's top edge still is below where it ends up when the panel is tucked away. */
export function browserSlideExtra(): number {
  return slidingRow ? Math.max(0, slidingRow.getBoundingClientRect().height) : 0;
}
