import type { WindowRect } from "@/app/layouts/model";

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

export function windowRectsMatch(actual: WindowRect, expected: WindowRect, tolerance = 4) {
  return (
    Math.abs(actual.x - expected.x) <= tolerance &&
    Math.abs(actual.y - expected.y) <= tolerance &&
    Math.abs(actual.width - expected.width) <= tolerance &&
    Math.abs(actual.height - expected.height) <= tolerance
  );
}
