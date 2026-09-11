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

  it("creates a blank Choose app pane by default", () => {
    const tab = createDefaultWorkspaceTab("space:family");

    expect(tab).toMatchObject({
      surfaceId: "space",
      groupKey: "space:family",
      title: "New Tab",
      placeholder: true,
      route: "/home",
    });
  });

  it("supports an explicit Discover preference", () => {
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

  it("falls back to Choose app for an invalid preference", () => {
    configureWorkspaceDefaultTab(999);

    expect(createDefaultWorkspaceTab("global")).toMatchObject({
      surfaceId: "home",
      title: "New Tab",
      placeholder: true,
      route: "/home",
    });
  });
});
