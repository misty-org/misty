import { describe, expect, it } from "vitest";
import { CompanionActivity } from "./companionActivity";

describe("companion automatic visibility", () => {
  it("hides after three seconds even with jitter, then wakes on deliberate movement", () => {
    const activity = new CompanionActivity();
    activity.sample({ x: 100, y: 100 }, undefined, 0);
    activity.sample({ x: 102, y: 99 }, undefined, 2900);
    expect(activity.presentation(2999, false).visible).toBe(true);
    expect(activity.presentation(3000, false)).toEqual({ visible: false, fadeMs: 400 });
    activity.sample({ x: 110, y: 100 }, undefined, 3100);
    expect(activity.presentation(3100, false).visible).toBe(true);
  });

  it("hides promptly on typing and requires fresh movement after the typing pause", () => {
    const activity = new CompanionActivity();
    activity.sample({ x: 0, y: 0 }, 4, 0);
    activity.sample({ x: 0, y: 0 }, 5, 100);
    expect(activity.presentation(100, false)).toEqual({ visible: false, fadeMs: 150 });
    activity.sample({ x: 100, y: 0 }, 6, 500);
    activity.sample({ x: 200, y: 0 }, 6, 1000);
    activity.sample({ x: 200, y: 0 }, 6, 1500);
    expect(activity.presentation(1500, false).visible).toBe(false);
    activity.sample({ x: 210, y: 0 }, 6, 1600);
    expect(activity.presentation(1600, false).visible).toBe(true);
  });

  it("keeps active feedback visible and allows an idle grace period afterward", () => {
    const activity = new CompanionActivity();
    activity.sample({ x: 0, y: 0 }, 0, 0);
    expect(activity.presentation(5000, true).visible).toBe(true);
    expect(activity.presentation(7999, false).visible).toBe(true);
    expect(activity.presentation(8000, false).visible).toBe(false);
    activity.sample({ x: 0, y: 0 }, 1, 8100);
    expect(activity.presentation(8100, true).visible).toBe(true);
    expect(activity.presentation(8200, false).visible).toBe(false);
  });

  it("does not mistake a native activity baseline for new typing after mounting", () => {
    const activity = new CompanionActivity();
    activity.sample({ x: -1500, y: 100 }, 42, 100);
    expect(activity.presentation(100, false).visible).toBe(true);
    activity.sample({ x: -1495, y: 100 }, 42, 200);
    activity.sample({ x: -1490, y: 100 }, 42, 300);
    expect(activity.presentation(3299, false).visible).toBe(true);
    expect(activity.presentation(3300, false).visible).toBe(false);
  });
});
