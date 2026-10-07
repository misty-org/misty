import { afterEach, expect, it } from "vitest";
import { configureWorkspaceDefaultView, createDefaultWorkspaceView } from "./workspaceDefaultView";
afterEach(() => configureWorkspaceDefaultView(1));
it("starts in Browser before a preference is configured", () => {
  expect(createDefaultWorkspaceView("global")).toMatchObject({
    surfaceId: "browser",
    route: "/browser",
    placeholder: true,
  });
});
it.each([
  [0, "home"],
  [1, "browser"],
  [2, "files"],
  [3, "agents"],
])("uses configured starting page %s", (index, surfaceId) => {
  configureWorkspaceDefaultView(Number(index));
  expect(createDefaultWorkspaceView("global")).toMatchObject({ surfaceId, placeholder: true });
});
it("falls back to Browser for invalid preferences and allocates independent identities", () => {
  configureWorkspaceDefaultView(999);
  const first = createDefaultWorkspaceView("global"),
    second = createDefaultWorkspaceView("global");
  expect(first.surfaceId).toBe("browser");
  expect(first.id).not.toBe(second.id);
  expect(first.instanceKey).not.toBe(second.instanceKey);
});

it("round-trips the configurable starting page through portable settings", async () => {
  const { portableValues, projectPreferences } =
    await import("@/features/settings/profiles/registry");
  expect(projectPreferences({}, {})).toMatchObject({
    general: { workspace_default_tab_index: 1 },
  });
  expect(portableValues({ general: { workspace_default_tab_index: 2 } })).toEqual({
    "app.tabs.startPage": "files",
  });
  expect(projectPreferences({}, { "app.tabs.startPage": "agents" })).toMatchObject({
    general: { workspace_default_tab_index: 3 },
  });
});
