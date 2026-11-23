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

export function isTopEdgeDragPress(event: { clientY: number; target: EventTarget | null }) {
  if (event.clientY > Math.min(72, Math.max(48, window.innerHeight * 0.05))) return false;
  if (shouldSuppressWindowDrag(event.target)) return false;
  const element = event.target instanceof Element ? event.target : null;
  const interactive = element?.closest(PAGE_INTERACTIVE_SELECTOR);
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
