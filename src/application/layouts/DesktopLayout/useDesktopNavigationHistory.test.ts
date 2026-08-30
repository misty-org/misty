import { describe, expect, it } from "vitest";
import { NavigationType } from "react-router-dom";
import { updateDesktopNavigationHistory } from "./useDesktopNavigationHistory";

describe("desktop navigation history", () => {
  it("remembers the furthest visited entry while moving backward", () => {
    const current = { currentIndex: 4, furthestIndex: 4 };
    expect(updateDesktopNavigationHistory(current, 3, NavigationType.Pop)).toEqual({
      currentIndex: 3,
      furthestIndex: 4,
    });
  });

  it("drops the old forward branch after a new navigation", () => {
    const current = { currentIndex: 2, furthestIndex: 5 };
    expect(updateDesktopNavigationHistory(current, 3, NavigationType.Push)).toEqual({
      currentIndex: 3,
      furthestIndex: 3,
    });
  });

  it("keeps replace navigations at the current history depth", () => {
    const current = { currentIndex: 3, furthestIndex: 5 };
    expect(updateDesktopNavigationHistory(current, 3, NavigationType.Replace)).toEqual(current);
  });
});
