import type { WindowRect } from "@/app/layouts/desktop-state";

const WINDOW_DRAG_SUPPRESS_SELECTOR = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "[role='button']",
  "[draggable='true']",
  "[data-misty-window-drag-block='true']",
  "[data-pointer-drag-source='true']",
  "[data-explorer-drag-source='true']",
  "[data-reorder-drag-source='true']",
  "[data-drag-handle]",
  "[data-drag-handle='true']",
].join(",");

export function shouldSuppressWindowDrag(target: EventTarget | null) {
  const element = typeof Element === "undefined" || !(target instanceof Element) ? null : target;
  return Boolean(element?.closest(WINDOW_DRAG_SUPPRESS_SELECTOR));
}

const PAGE_INTERACTIVE_SELECTOR = [
  "summary",
  "label",
  "video",
  "audio",
  "canvas",
  "iframe",
  "[role='link']",
  "[role='textbox']",
  "[role='menuitem']",
  "[role='tab']",
  "[contenteditable]:not([contenteditable='false'])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * The top twentieth of the window (at most 72px) moves it from empty space on any page, as the same
 * edge of a native browser page does: links, controls, fields and anything draggable keep
 * their presses.
 */
export function isTopEdgeDragPress(event: { clientY: number; target: EventTarget | null }) {
  // At least a page's 48px top band, so pages without a title bar still have one to hold.
  if (event.clientY > Math.min(72, Math.max(48, window.innerHeight * 0.05))) return false;
  if (shouldSuppressWindowDrag(event.target)) return false;
  const element = event.target instanceof Element ? event.target : null;
  const interactive = element?.closest(PAGE_INTERACTIVE_SELECTOR);
  // A workspace pane takes focus itself (tabIndex 0), so it is not a control: only what it holds
  // can opt out.
  return !interactive || interactive.hasAttribute("data-workspace-pane");
}

export function windowRectsMatch(actual: WindowRect, expected: WindowRect, tolerance = 4) {
  return (
    Math.abs(actual.x - expected.x) <= tolerance &&
    Math.abs(actual.y - expected.y) <= tolerance &&
    Math.abs(actual.width - expected.width) <= tolerance &&
    Math.abs(actual.height - expected.height) <= tolerance
  );
}
