import { getAppliedAppRenderScale } from "@/shared/hooks/use_app_zoom";

const browserBlockingOverlaySelector = [
  '[data-navigation-tooltip="true"]:not([data-state="closed"])',
  '[data-slot="dropdown-menu-content"][data-state="open"]',
  '[data-slot="dropdown-menu-sub-content"][data-state="open"]',
  '[data-slot="popover-content"][data-state="open"]',
  '[data-slot="select-content"][data-state="open"]',
  '[data-slot="dialog-content"][data-state="open"]',
  '[data-slot="alert-dialog-content"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="dialog"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
  '[data-slot="sheet-content"][data-state="open"]',
  '[data-slot="workspace-overlay"]',
  '[data-slot="suggestion-list"]',
  '[data-slot="tour"]',
  '[data-slot="viewport-layer"][role="dialog"]',
].join(",");
const overlaps = (a: DOMRect, b: DOMRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

function tooltipOverPage(root: ParentNode): boolean {
  const tooltips = root.querySelectorAll(
    '[data-slot="tooltip-content"]:not([data-state="closed"])',
  );
  if (!tooltips.length) return false;
  const pages = Array.from(
    root.querySelectorAll("[data-browser-page-host][data-browser-page-presented]"),
    (page) => page.getBoundingClientRect(),
  ).filter((rect) => rect.width > 0 && rect.height > 0);
  return Array.from(tooltips).some((tooltip) => {
    const rect = tooltip.getBoundingClientRect();
    return pages.some((page) => overlaps(rect, page));
  });
}

export function browserBlockingOverlayOpen(root: ParentNode = document): boolean {
  return root.querySelector(browserBlockingOverlaySelector) !== null || tooltipOverPage(root);
}

export type BrowserNoticeRect = [number, number, number, number];

export function browserNoticeRadius(scale = getAppliedAppRenderScale()): number {
  return 8 * scale;
}

export function browserNoticeRects(
  root: ParentNode = document,
  scale = getAppliedAppRenderScale(),
): BrowserNoticeRect[] {
  return Array.from(root.querySelectorAll('[data-misty-notification="true"]'), (notice) => {
    const box = notice.getBoundingClientRect();
    return [box.left * scale, box.top * scale, box.right * scale, box.bottom * scale];
  });
}
