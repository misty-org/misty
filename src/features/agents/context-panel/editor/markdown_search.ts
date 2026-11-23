// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import {
  findTextMatches,
  highlightSupported,
  type TextSearchOptions,
} from "../../conversations/view/navigation/dom_text_search";

const HIGHLIGHT_ALL = "misty-md-search";
const HIGHLIGHT_CURRENT = "misty-md-search-current";

const SCROLL_MARGIN = 24;

export function clearMarkdownSearchHighlights(): void {
  if (!highlightSupported()) return;
  CSS.highlights.delete(HIGHLIGHT_ALL);
  CSS.highlights.delete(HIGHLIGHT_CURRENT);
}

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
