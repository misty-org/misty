import { expect, it } from "vitest";
import { selectAppearancePreferences } from "./preferences";

it("uses the comfortable baseline for defaults and existing 110% settings", () => {
  expect(selectAppearancePreferences({}).appZoom).toBe(1);
  expect(selectAppearancePreferences({ appearance: { app_zoom: 1 } }).appZoom).toBe(1);
  expect(selectAppearancePreferences({ appearance: { app_zoom: 1.1 } }).appZoom).toBe(1);
  expect(selectAppearancePreferences({ appearance: { app_zoom: 1.21 } }).appZoom).toBe(1.1);
});
