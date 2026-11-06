import { expect, it } from "vitest";
import { browserNoticeRects } from "./browserBlockingOverlay";
import { browserBlockingOverlayOpen } from "./BrowserRuntimeBridge";

it("keeps navigation hints above native pages until dismissed", () => {
  const root = document.createElement("div");
  const hint = document.createElement("div");
  hint.dataset.navigationTooltip = "true";
  root.append(hint);
  for (const state of ["delayed-open", "instant-open"]) {
    hint.dataset.state = state;
    expect(browserBlockingOverlayOpen(root)).toBe(true);
  }
  hint.dataset.state = "closed";
  expect(browserBlockingOverlayOpen(root)).toBe(false);
  hint.remove();
  expect(browserBlockingOverlayOpen(root)).toBe(false);
});

it("reports notices by their box, in zoomed points, instead of as blocking overlays", () => {
  const root = document.createElement("div");
  const notice = document.createElement("aside");
  notice.dataset.mistyNotification = "true";
  notice.getBoundingClientRect = () => new DOMRect(10, 20, 100, 50);
  root.append(notice);
  expect(browserBlockingOverlayOpen(root)).toBe(false);
  expect(browserNoticeRects(root, 2)).toEqual([[20, 40, 220, 140]]);
});

it("counts popups with no open state while they are on the page", () => {
  for (const [slot, role] of [
    ["workspace-overlay", "presentation"],
    ["suggestion-list", "listbox"],
    ["viewport-layer", "dialog"],
  ]) {
    const root = document.createElement("div");
    const popup = document.createElement("div");
    popup.dataset.slot = slot;
    popup.setAttribute("role", role);
    root.append(popup);
    expect(browserBlockingOverlayOpen(root)).toBe(true);
    popup.remove();
    expect(browserBlockingOverlayOpen(root)).toBe(false);
  }
});

it("leaves the page inside a peek and floating agent surfaces live", () => {
  const root = document.createElement("div");
  const peek = document.createElement("div");
  peek.setAttribute("role", "dialog");
  const surface = document.createElement("div");
  surface.dataset.slot = "viewport-layer";
  surface.setAttribute("role", "region");
  root.append(peek, surface);
  expect(browserBlockingOverlayOpen(root)).toBe(false);
});

it("leaves native pages live beside the Misty panel", () => {
  // The workspace makes room for the panel, so it never covers a page.
  const root = document.createElement("div");
  const panel = document.createElement("aside");
  panel.setAttribute("data-misty-panel", "right");
  root.append(panel);
  expect(browserBlockingOverlayOpen(root)).toBe(false);
});
