import { afterEach, describe, expect, it } from "vitest";
import { createDockLeaf, createHomeDockTab } from "@/features/workspace";
import { activeBrowserSurfaceExists, browserBlockingOverlayOpen } from "./BrowserRuntimeBridge";

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

describe("active native Browser ownership", () => {
  it("releases native Browser content when Home is the active surface", () => {
    const root = createDockLeaf([createHomeDockTab()]);

    expect(activeBrowserSurfaceExists(root)).toBe(false);
  });

  it("keeps native Browser content when any split pane actively owns it", () => {
    const home = createHomeDockTab();
    const root = createDockLeaf([
      {
        ...home,
        id: "browser-tab",
        surfaceId: "browser",
        groupKey: "tool:browser",
        instanceKey: "browser-instance",
        route: "/browser",
      },
    ]);

    expect(activeBrowserSurfaceExists(root)).toBe(true);
  });
});
