import { describe, expect, it } from "vitest";
import { selectAppearancePreferences, selectEditorPreferences } from "./preferences";

describe("selectEditorPreferences", () => {
  it("uses comfortable Code defaults", () => {
    const preferences = selectEditorPreferences({});
    expect(preferences.fontSize).toBe(14);
    expect(preferences.interfaceScale).toBe(1);
    expect(preferences.theme).toBe("gruvbox-dark");
  });

  it("clamps interface scale without changing valid editor values", () => {
    expect(
      selectEditorPreferences({ editor: { interface_scale: 0.2, font_size: 18 } }),
    ).toMatchObject({ interfaceScale: 0.8, fontSize: 18 });
    expect(selectEditorPreferences({ editor: { interface_scale: 3 } }).interfaceScale).toBe(1.5);
  });
});

it("uses the comfortable baseline for defaults and existing 110% settings", () => {
  expect(selectAppearancePreferences({}).appZoom).toBe(1);
  expect(selectAppearancePreferences({ appearance: { app_zoom: 1 } }).appZoom).toBe(1);
  expect(selectAppearancePreferences({ appearance: { app_zoom: 1.1 } }).appZoom).toBe(1);
  expect(selectAppearancePreferences({ appearance: { app_zoom: 1.21 } }).appZoom).toBe(1.1);
});
