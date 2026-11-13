import { getAppliedAppRenderScale } from "@/shared/hooks/useAppZoom";

const browserBlockingOverlaySelector = [
  // Rail hints extend over native pages, above the renderer's own DOM layers.
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
  // These have no open state: being on the page means they are open.
  '[data-slot="workspace-overlay"]',
  '[data-slot="suggestion-list"]',
  '[data-slot="viewport-layer"][role="dialog"]',
].join(",");
export function browserBlockingOverlayOpen(root: ParentNode = document): boolean {
  return root.querySelector(browserBlockingOverlaySelector) !== null;
}

/** Left, top, right and bottom in the renderer view's points (CSS pixels times app zoom). */
export type BrowserNoticeRect = [number, number, number, number];

/** The corner radius of a notice (`rounded-lg`), in the same points as its box. */
export function browserNoticeRadius(scale = getAppliedAppRenderScale()): number {
  return 8 * scale;
}

/** Where notices sit. They float over pages too, but only ever cover their own box. */
export function browserNoticeRects(
  root: ParentNode = document,
  scale = getAppliedAppRenderScale(),
): BrowserNoticeRect[] {
  return Array.from(root.querySelectorAll('[data-misty-notification="true"]'), (notice) => {
    const box = notice.getBoundingClientRect();
    return [box.left * scale, box.top * scale, box.right * scale, box.bottom * scale];
  });
}
