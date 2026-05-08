import { afterEach, describe, expect, it } from "vitest";
import { browserBlockingOverlayOpen } from "./BrowserRuntimeBridge";

describe("browser blocking overlays", () => {
  afterEach(() => document.body.replaceChildren());

  it("recognizes an open workspace dropdown as blocking native browser content", () => {
    const menu = document.createElement("div");
    menu.dataset.slot = "dropdown-menu-content";
    menu.dataset.state = "open";
    document.body.appendChild(menu);

    expect(browserBlockingOverlayOpen()).toBe(true);
  });

  it("restores native browser content once the overlay closes", () => {
    const menu = document.createElement("div");
    menu.dataset.slot = "dropdown-menu-content";
    menu.dataset.state = "closed";
    document.body.appendChild(menu);

    expect(browserBlockingOverlayOpen()).toBe(false);
  });
});
