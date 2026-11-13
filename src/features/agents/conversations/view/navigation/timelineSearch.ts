// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import type { GlobalAiMessage } from "../../state/conversationTypes";
import {
  findStringMatches,
  findTextMatches,
  highlightSupported,
  type TextSearchOptions,
} from "./domTextSearch";
import { FIND_CURRENT_HIGHLIGHT, FIND_MATCH_HIGHLIGHT } from "@/shared/ui";
import { REVEAL_FOLD_EVENT } from "../../../progress/WorkGroup";

/**
 * Search inside a chat (⌘F): counting and finding which message a match is in work on the
 * messages' text; highlighting works on the DOM through the CSS Custom Highlight API, so the
 * Markdown and timeline renderers are untouched and their memoized output stays valid.
 */

/** A message's searchable text: what it says, and for a reply also what it said while working
 * and the steps it took, which the search opens when it lands there. */
export function messageSearchText(message: GlobalAiMessage): string {
  const parts = [message.content];
  for (const item of message.progress ?? [])
    parts.push(
      item.type === "note" ? item.text : (item.activity?.detail ?? item.path ?? item.name),
    );
  return parts.join("\n");
}

interface TimelineMatch {
  /** The message the match is in, which its element carries as `data-message-id`. */
  messageId: string;
  messageIndex: number;
  start: number;
  end: number;
}

/** Every match, one per occurrence in document order (as the browser's own "3/12" counts).
 * Case-insensitive unless asked; a blank query finds nothing. */
export function findTimelineMatches(
  messages: GlobalAiMessage[],
  query: string,
  options?: TextSearchOptions,
): TimelineMatch[] {
  const matches: TimelineMatch[] = [];
  messages.forEach((message, messageIndex) => {
    for (const range of findStringMatches(messageSearchText(message), query, options))
      matches.push({ messageId: message.id, messageIndex, start: range.start, end: range.end });
  });
  return matches;
}

const HIGHLIGHT_ALL = FIND_MATCH_HIGHLIGHT;
const HIGHLIGHT_CURRENT = FIND_CURRENT_HIGHLIGHT;

/** WebKit needs Safari 17.2; without it search still counts and jumps to the message. */
export function searchHighlightSupported(): boolean {
  return highlightSupported();
}

export function clearSearchHighlights(): void {
  if (!searchHighlightSupported()) return;
  CSS.highlights.delete(HIGHLIGHT_ALL);
  CSS.highlights.delete(HIGHLIGHT_CURRENT);
}

/**
 * Highlights every match under `root`. The chosen match in the current message goes in the
 * CURRENT group, drawn above the rest, and its Range comes back so the word itself can be
 * scrolled into view, not just its message.
 *
 * Counting runs on the source text, highlighting on what rendered: link targets and folded steps
 * can make the two disagree, and then picking a Range by number would pick the wrong word. When
 * `currentTotal` doesn't match what rendered, the whole message is marked current and no Range
 * comes back.
 */
export function paintSearchHighlights(
  root: HTMLElement,
  query: string,
  currentMessageId: string | null,
  options?: TextSearchOptions,
  currentOccurrence = 0,
  currentTotal?: number,
): Range | null {
  clearSearchHighlights();
  if (!query.trim() || !searchHighlightSupported()) return null;
  const all: Range[] = [];
  const current: Range[] = [];
  for (const match of findTextMatches(root, query, options)) {
    const owner = match.node.parentElement
      ?.closest("[data-message-id]")
      ?.getAttribute("data-message-id");
    const range = new Range();
    range.setStart(match.node, match.start);
    range.setEnd(match.node, match.end);
    if (owner && owner === currentMessageId) current.push(range);
    else all.push(range);
  }
  const countsAgree = currentTotal === undefined || current.length === currentTotal;
  if (!countsAgree) {
    if (all.length) CSS.highlights.set(HIGHLIGHT_ALL, new Highlight(...all));
    if (current.length) {
      const highlight = new Highlight(...current);
      highlight.priority = 1;
      CSS.highlights.set(HIGHLIGHT_CURRENT, highlight);
    }
    return null;
  }
  const active = current[currentOccurrence] ?? current[0] ?? null;
  for (const range of current) if (range !== active) all.push(range);
  if (all.length) CSS.highlights.set(HIGHLIGHT_ALL, new Highlight(...all));
  if (active) {
    const highlight = new Highlight(active);
    // Text in both groups must show the current one on top.
    highlight.priority = 1;
    CSS.highlights.set(HIGHLIGHT_CURRENT, highlight);
  }
  return active;
}

/** The first match `paintSearchHighlights` drew in a message, for when it couldn't pick one. */
export function firstMatchIn(
  root: HTMLElement,
  query: string,
  messageId: string,
  options?: TextSearchOptions,
): Range | null {
  for (const match of findTextMatches(root, query, options)) {
    const owner = match.node.parentElement
      ?.closest("[data-message-id]")
      ?.getAttribute("data-message-id");
    if (owner !== messageId) continue;
    const range = new Range();
    range.setStart(match.node, match.start);
    range.setEnd(match.node, match.end);
    return range;
  }
  return null;
}

/**
 * Opens every closed fold (a reply's folded steps, a step's output) that holds `range`, so the
 * match can be seen. True when one had to open: it animates open, so scroll once it has.
 */
export function revealFoldsAround(range: Range | null): boolean {
  let element: Element | null | undefined = range?.startContainer.parentElement;
  let opened = false;
  while (element) {
    const fold: Element | null = element.closest(".agent-progress-fold");
    if (!fold) break;
    if (!fold.hasAttribute("data-open")) {
      fold.dispatchEvent(new Event(REVEAL_FOLD_EVENT));
      opened = true;
    }
    element = fold.parentElement;
  }
  return opened;
}

/** How long a fold takes to open (`Fold` in `WorkGroup.tsx`), with a little to spare. */
export const FOLD_OPEN_MS = 240;

/** Space kept above and below a match scrolled into view, in pixels. */
const SCROLL_MARGIN = 24;

/** Scrolls only until the match is visible, as the browser's own find does. */
export function scrollMatchIntoView(scrollEl: HTMLElement | null, range: Range | null): void {
  if (!scrollEl || !range) return;
  const rect = range.getBoundingClientRect();
  const box = scrollEl.getBoundingClientRect();
  // A header floating over the scroller's top covers that band (its `scroll-padding-top`).
  const top =
    box.top + (Number.parseFloat(getComputedStyle(scrollEl).scrollPaddingTop) || 0) + SCROLL_MARGIN;
  if (rect.top < top) scrollEl.scrollTop += rect.top - top;
  else if (rect.bottom > box.bottom - SCROLL_MARGIN)
    scrollEl.scrollTop += rect.bottom - box.bottom + SCROLL_MARGIN;
}
