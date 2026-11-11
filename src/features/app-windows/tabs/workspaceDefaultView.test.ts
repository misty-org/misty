import { afterEach, expect, it } from "vitest";
import {
  configureWorkspaceDefaultView,
  createDefaultWorkspaceView,
  workspaceDefaultViewOption,
  workspaceDefaultViewOptions,
  workspaceDefaultViewStoredIndex,
} from "./workspaceDefaultView";
afterEach(() => configureWorkspaceDefaultView(3));
it("starts in Agents before a preference is configured", () => {
  expect(createDefaultWorkspaceView()).toMatchObject({
    surfaceId: "agents",
    route: "/agents",
    placeholder: true,
  });
});
it.each([
  // 0 was the retired Home page.
  [0, "agents"],
  // 1 was the browser, which a person no longer has.
  [1, "agents"],
  // 2 was the retired Files view.
  [2, "agents"],
  [3, "agents"],
])("uses configured starting page %s", (index, surfaceId) => {
  configureWorkspaceDefaultView(Number(index));
  expect(createDefaultWorkspaceView()).toMatchObject({
    surfaceId,
    placeholder: true,
  });
});
it("falls back to Agents for invalid preferences and allocates independent identities", () => {
  configureWorkspaceDefaultView(999);
  const first = createDefaultWorkspaceView(),
    second = createDefaultWorkspaceView();
  expect(first.surfaceId).toBe("agents");
  expect(first.id).not.toBe(second.id);
  expect(first.instanceKey).not.toBe(second.instanceKey);
});

it("maps stored indexes to the options shown in Settings", () => {
  expect(workspaceDefaultViewOptions[workspaceDefaultViewOption(3)]).toBe("Agents");
  expect(workspaceDefaultViewOptions[workspaceDefaultViewOption(0)]).toBe("Agents");
  expect(workspaceDefaultViewOptions[workspaceDefaultViewOption(1)]).toBe("Agents");
  expect(workspaceDefaultViewStoredIndex(workspaceDefaultViewOptions.indexOf("Agents"))).toBe(3);
  // The retired Files choice opens the default view.
  expect(workspaceDefaultViewOptions[workspaceDefaultViewOption(2)]).toBe("Agents");
});

it("round-trips the configurable starting page through portable settings", async () => {
  const { portableValues, projectPreferences } =
    await import("@/features/settings/device-preferences/registry");
  expect(projectPreferences({}, {})).toMatchObject({
    general: { workspace_default_tab_index: 3 },
  });
  expect(portableValues({ general: { workspace_default_tab_index: 2 } })).toEqual({
    "app.tabs.startPage": "files",
  });
  expect(projectPreferences({}, { "app.tabs.startPage": "agents" })).toMatchObject({
    general: { workspace_default_tab_index: 3 },
  });
});
