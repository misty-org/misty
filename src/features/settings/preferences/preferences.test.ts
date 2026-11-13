import { expect, it } from "vitest";
import { selectAppearancePreferences } from "./preferences";

it("defaults to 100% and restores stored physical zoom scales", () => {
  expect(selectAppearancePreferences({}).appZoom).toBe(1);
  expect(selectAppearancePreferences({ appearance: { app_zoom: 1 } }).appZoom).toBe(1);
  // 100% is drawn at 110%, so a stored physical 1.1 is 100% and 1.21 is 110%.
  expect(selectAppearancePreferences({ appearance: { app_zoom: 1.1 } }).appZoom).toBe(1);
  expect(selectAppearancePreferences({ appearance: { app_zoom: 1.21 } }).appZoom).toBe(1.1);
});
