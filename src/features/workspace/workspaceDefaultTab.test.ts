import { afterEach, describe, expect, it } from "vitest";
import { dockTabs } from "./dockTree";
import { defaultBrowserHomeUrl } from "./model";
import { initialWorkspaceLayout } from "./virtualWindows";
import { configureWorkspaceDefaultTab, createDefaultWorkspaceTab } from "./workspaceDefaultTab";

describe("workspace default tab", () => {
  afterEach(() => configureWorkspaceDefaultTab(0));

  it("opens Google without depending on a Space or installed app", () => {
    expect(createDefaultWorkspaceTab("global")).toMatchObject({
      surfaceId: "browser",
      groupKey: "tool:browser",
      title: "Google",
      route: "/browser",
      state: { url: defaultBrowserHomeUrl },
    });
    expect(createDefaultWorkspaceTab("global").placeholder).toBeUndefined();
  });

  it("ignores retired default-app preferences when restoring a layout", () => {
    configureWorkspaceDefaultTab(999);
    expect(dockTabs(initialWorkspaceLayout("space:family").root)).toMatchObject([
      { surfaceId: "browser", route: "/browser", state: { url: defaultBrowserHomeUrl } },
    ]);
  });

  it("allocates independent browser runtime identities for every new tab", () => {
    const first = createDefaultWorkspaceTab("global");
    const second = createDefaultWorkspaceTab("global");
    expect(first.id).not.toBe(second.id);
    expect(first.instanceKey).toBe(first.id);
    expect(second.instanceKey).toBe(second.id);
  });
});
