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
