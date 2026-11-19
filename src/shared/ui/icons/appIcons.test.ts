import { describe, expect, it } from "vitest";
import { appIcon, spaceIcons } from "./appIcons";

describe("a Space's tabs wear the Space's own icons", () => {
  it.each([
    ["home", spaceIcons.space],
    ["space", spaceIcons.space],
    ["social", spaceIcons.chat],
    ["journal", spaceIcons.docs],
    ["slides", spaceIcons.slides],
    ["data", spaceIcons.data],
    ["whiteboards", spaceIcons.whiteboards],
    ["planner", spaceIcons.planner],
    ["calendar", spaceIcons.calendar],
    ["media", spaceIcons.media],
    // A tab saved before the Library became Media.
    ["library", spaceIcons.media],
  ])("%s", (tool, icon) => {
    expect(appIcon(tool, "space")).toBe(icon);
  });
});
