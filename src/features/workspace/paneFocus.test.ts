import { expect, it } from "vitest";
import { selectPaneFocusPreferences } from "./paneFocus";
it("defaults to restrained dimming", () => {
  expect(selectPaneFocusPreferences()).toEqual({ dim: true, strength: 0.15 });
});
it.each([true, false])("keeps the chosen strength with dimming %s", (dim) => {
  expect(
    selectPaneFocusPreferences({
      appearance: { dim_inactive_panes: dim, pane_dim_strength: 0.23 },
    }),
  ).toEqual({ dim, strength: 0.23 });
});
it("bounds dimming between none and half", () => {
  expect(selectPaneFocusPreferences({ appearance: { pane_dim_strength: 3 } }).strength).toBe(0.5);
  expect(selectPaneFocusPreferences({ appearance: { pane_dim_strength: -1 } }).strength).toBe(0);
});
