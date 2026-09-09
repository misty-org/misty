import { afterEach, describe, expect, it } from "vitest";
import { dockTabs } from "./dockTree";
import { initialWorkspaceLayout } from "./virtualWindows";
import {
  configureWorkspaceDefaultTab,
  createDefaultWorkspaceTab,
  workspaceDefaultTabOptions,
} from "./workspaceDefaultTab";

describe("workspace default tab", () => {
  afterEach(() => configureWorkspaceDefaultTab(0));

  it("creates Space Home by default", () => {
    const tab = createDefaultWorkspaceTab("space:family");

    expect(tab).toMatchObject({
      surfaceId: "space",
      groupKey: "space:family",
      title: "Home",
      route: "/spaces/family/home",
    });
  });

  it("uses Discover as the only configurable alternative to Home", () => {
    configureWorkspaceDefaultTab(workspaceDefaultTabOptions.indexOf("Discover"));

    expect(dockTabs(initialWorkspaceLayout("space:family").root)).toMatchObject([
      {
        surfaceId: "marketplace",
        groupKey: "tool:marketplace",
        title: "Discover",
        route: "/discover",
      },
    ]);
  });

  it("falls back to Home for an invalid preference", () => {
    configureWorkspaceDefaultTab(999);

    expect(createDefaultWorkspaceTab("global")).toMatchObject({
      surfaceId: "home",
      title: "Home",
      route: "/home",
    });
  });
});
