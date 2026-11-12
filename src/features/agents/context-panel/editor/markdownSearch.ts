// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { findTextMatches, highlightSupported, type TextSearchOptions } from "./domTextSearch";

/**
 * Find in a file's Markdown preview: matches are colored with the CSS Custom Highlight API, so
 * the rendered document is never changed. The text matching is shared with other in-page
 * searches; the highlight names are this preview's own.
 */
const HIGHLIGHT_ALL = "misty-md-search";
const HIGHLIGHT_CURRENT = "misty-md-search-current";

/** Room left above and below a match scrolled into view, so it never sits on the edge. */
const SCROLL_MARGIN = 24;

export function clearMarkdownSearchHighlights(): void {
  if (!highlightSupported()) return;
  CSS.highlights.delete(HIGHLIGHT_ALL);
  CSS.highlights.delete(HIGHLIGHT_CURRENT);
}

/** Every match inside the preview, as Ranges in document order (also without highlight
 * support, so callers can still count and scroll). */
export function findMarkdownMatches(
  root: HTMLElement,
  query: string,
  options?: TextSearchOptions,
): Range[] {
  const doc = root.ownerDocument;
  return findTextMatches(root, query, options).map(({ node, start, end }) => {
    const range = doc.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    return range;
  });
}

/** Paints every match, and the one at `currentIndex` in the stronger current group. */
export function paintMarkdownSearchHighlights(ranges: Range[], currentIndex: number): void {
  clearMarkdownSearchHighlights();
  if (!highlightSupported()) return;
  const all: Range[] = [];
  const current: Range[] = [];
  ranges.forEach((range, index) => {
    (index === currentIndex ? current : all).push(range);
  });
  if (all.length > 0) CSS.highlights.set(HIGHLIGHT_ALL, new Highlight(...all));
  if (current.length > 0) {
    const highlight = new Highlight(...current);
    highlight.priority = 1;
    CSS.highlights.set(HIGHLIGHT_CURRENT, highlight);
  }
}

/** Scrolls only as far as needed to show the match (nothing when it already shows), like a
 * browser's find, and without scrollIntoView so no outer container scrolls with it. */
export function scrollRangeIntoView(scrollEl: HTMLElement | null, range: Range | undefined): void {
  if (!scrollEl || !range) return;
  const rect = range.getBoundingClientRect();
  const box = scrollEl.getBoundingClientRect();
  if (rect.top < box.top + SCROLL_MARGIN) {
    scrollEl.scrollTop += rect.top - box.top - SCROLL_MARGIN;
  } else if (rect.bottom > box.bottom - SCROLL_MARGIN) {
    scrollEl.scrollTop += rect.bottom - box.bottom + SCROLL_MARGIN;
  }
}
