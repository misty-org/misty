// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import type { GlobalAiMessage } from "../../state/conversation_types";
import {
  findStringMatches,
  findTextMatches,
  highlightSupported,
  type TextSearchOptions,
} from "./dom_text_search";
import { FIND_CURRENT_HIGHLIGHT, FIND_MATCH_HIGHLIGHT } from "@misty/ui";
import { REVEAL_FOLD_EVENT } from "../../../progress/WorkGroup";

export function messageSearchText(message: GlobalAiMessage): string {
  const parts = [message.content];
  for (const item of message.progress ?? [])
    parts.push(
      item.type === "note" ? item.text : (item.activity?.detail ?? item.path ?? item.name),
    );
  return parts.join("\n");
}

interface TimelineMatch {
  messageId: string;
  messageIndex: number;
  start: number;
  end: number;
}

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

export function searchHighlightSupported(): boolean {
  return highlightSupported();
}

export function clearSearchHighlights(): void {
  if (!searchHighlightSupported()) return;
  CSS.highlights.delete(HIGHLIGHT_ALL);
  CSS.highlights.delete(HIGHLIGHT_CURRENT);
}

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
    highlight.priority = 1;
    CSS.highlights.set(HIGHLIGHT_CURRENT, highlight);
  }
  return active;
}

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

export const FOLD_OPEN_MS = 240;

const SCROLL_MARGIN = 24;

export function scrollMatchIntoView(scrollEl: HTMLElement | null, range: Range | null): void {
  if (!scrollEl || !range) return;
  const rect = range.getBoundingClientRect();
  const box = scrollEl.getBoundingClientRect();
  const top =
    box.top + (Number.parseFloat(getComputedStyle(scrollEl).scrollPaddingTop) || 0) + SCROLL_MARGIN;
  if (rect.top < top) scrollEl.scrollTop += rect.top - top;
  else if (rect.bottom > box.bottom - SCROLL_MARGIN)
    scrollEl.scrollTop += rect.bottom - box.bottom + SCROLL_MARGIN;
}
