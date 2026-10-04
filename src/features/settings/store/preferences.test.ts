import { expect, it } from "vitest";
import { selectAppearancePreferences, selectGeneralPreferences } from "./preferences";

it("defaults new tabs to Browser while preserving an explicit Home preference", () => {
  expect(selectGeneralPreferences({}).workspaceDefaultTabIndex).toBe(1);
  expect(
    selectGeneralPreferences({ general: { workspace_default_tab_index: 0 } })
      .workspaceDefaultTabIndex,
  ).toBe(0);
});

it("defaults to 100% and restores stored physical zoom scales", () => {
  expect(selectAppearancePreferences({}).appZoom).toBe(1);
  expect(selectAppearancePreferences({ appearance: { app_zoom: 1 } }).appZoom).toBe(1);
  expect(selectAppearancePreferences({ appearance: { app_zoom: 1.1 } }).appZoom).toBe(1.1);
  expect(selectAppearancePreferences({ appearance: { app_zoom: 1.21 } }).appZoom).toBe(1.2);
});
