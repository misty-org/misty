import { expect, it } from "vitest";
import { dockingGeometry } from "./dockingGeometry";
import { dockPositions } from "@/features/app-shell/dockingLayout";
it("shares the native titlebar with top tabs, including hidden and right navigation", () => {
  for (const position of ["left", "right", "bottom"] as const)
    for (const hidden of [false, true]) {
      const geometry = dockingGeometry(position, 264, hidden, true);
      expect(geometry.content.gridRow).toBe(position === "bottom" ? "1 / 3" : "1 / -1");
      expect(geometry.content.gridColumn).toBe(position === "left" ? 2 : 1);
      expect(geometry.navigation.gridRow).toBe(position === "bottom" ? 3 : 2);
    }
});
it("keeps chrome space for side and bottom tabs", () => {
  for (const position of dockPositions)
    for (const hidden of [false, true]) {
      const geometry = dockingGeometry(position, 264, hidden, false);
      expect(String(geometry.frame.gridTemplateRows).startsWith("38px ")).toBe(true);
      expect(geometry.content.gridRow).toBe(position === "top" ? 3 : 2);
      if (position !== "bottom") expect(geometry.floating.top).toBe(38);
      if (hidden)
        expect(
          `${geometry.frame.gridTemplateRows} ${geometry.frame.gridTemplateColumns}`,
        ).toContain("0px");
    }
});
