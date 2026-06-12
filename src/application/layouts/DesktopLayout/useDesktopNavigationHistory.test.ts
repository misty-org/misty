import { describe, expect, it } from "vitest";
import { NavigationType } from "react-router-dom";
import {
  relativeDesktopHistoryIndex,
  updateDesktopNavigationHistory,
} from "./useDesktopNavigationHistory";

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

  it("does not treat entries from before Misty mounted as app history", () => {
    expect(relativeDesktopHistoryIndex(7, 7)).toBe(0);
    expect(relativeDesktopHistoryIndex(7, 9)).toBe(2);
    expect(relativeDesktopHistoryIndex(7, 6)).toBe(0);
  });
});
