import { expect, it } from "vitest";
import { selectPaneFocusPreferences } from "./paneFocus";
it("defaults to restrained dimming with no active border", () => {
  expect(selectPaneFocusPreferences()).toEqual({ dim: true, strength: 0.15, indicator: "none" });
});
it.each([true, false])("allows every indicator independently with dimming %s", (dim) => {
  for (const indicator of ["none", "outline", "border"]) {
    expect(
      selectPaneFocusPreferences({
        appearance: {
          dim_inactive_panes: dim,
          pane_focus_indicator: indicator,
          pane_dim_strength: 0.23,
        },
      }),
    ).toEqual({ dim, strength: 0.23, indicator });
  }
});
it("bounds dimming and rejects unknown indicators", () => {
  expect(
    selectPaneFocusPreferences({
      appearance: { pane_dim_strength: 3, pane_focus_indicator: "glow" },
    }),
  ).toMatchObject({ strength: 0.4, indicator: "none" });
});
