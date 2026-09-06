import { expect, it } from "vitest";
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

it("leaves native pages live beside the Misty panel", () => {
  // The workspace makes room for the panel, so it never covers a page.
  const root = document.createElement("div");
  const panel = document.createElement("aside");
  panel.setAttribute("data-misty-panel", "right");
  root.append(panel);
  expect(browserBlockingOverlayOpen(root)).toBe(false);
});
