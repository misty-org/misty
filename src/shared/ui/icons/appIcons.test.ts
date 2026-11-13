import { describe, expect, it } from "vitest";
import { appIcon, spaceIcons } from "./appIcons";

describe("a Space's tabs wear the Space's own icons", () => {
  it.each([
    ["home", spaceIcons.space],
    ["space", spaceIcons.space],
    ["social", spaceIcons.chat],
    ["journal", spaceIcons.docs],
    ["planner", spaceIcons.planner],
    ["calendar", spaceIcons.calendar],
    ["library", spaceIcons.library],
  ])("%s", (tool, icon) => {
    expect(appIcon(tool, "space")).toBe(icon);
  });
});
