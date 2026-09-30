import { afterEach, expect, it } from "vitest";
import {
  configureWorkspaceDefaultView,
  createDefaultWorkspaceView,
  createHomeWorkspaceView,
} from "./workspaceDefaultView";
afterEach(() => configureWorkspaceDefaultView(0));
it("starts on replaceable Home by default, with a distinct established Home factory", () => {
  expect(createDefaultWorkspaceView("global")).toMatchObject({
    surfaceId: "home",
    route: "/home",
    placeholder: true,
  });
  expect(createHomeWorkspaceView("global")).toMatchObject({
    surfaceId: "home",
    placeholder: false,
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
it("falls back to Home for invalid preferences and allocates independent identities", () => {
  configureWorkspaceDefaultView(999);
  const first = createDefaultWorkspaceView("global"),
    second = createDefaultWorkspaceView("global");
  expect(first.surfaceId).toBe("home");
  expect(first.id).not.toBe(second.id);
  expect(first.instanceKey).not.toBe(second.instanceKey);
});

it("round-trips the configurable starting page through portable settings", async () => {
  const { portableValues, projectPreferences } =
    await import("@/features/settings/profiles/registry");
  expect(portableValues({ general: { workspace_default_tab_index: 2 } })).toEqual({
    "app.tabs.startPage": "files",
  });
  expect(projectPreferences({}, { "app.tabs.startPage": "agents" })).toMatchObject({
    general: { workspace_default_tab_index: 3 },
  });
});
