import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clickHitsPoint,
  CompanionGuideStep,
  GUIDE_WAIT_MS,
  nextStepPrompt,
} from "./companionGuide";
import type { PresentedPoint } from "./protocol";

const invoke = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
afterEach(() => {
  invoke.mockClear();
  vi.useRealTimers();
});

const point: PresentedPoint = {
  x: 100,
  y: 50,
  displayId: 1,
  label: "open Source Control",
  guide: { step: 1, total: 3 },
};

describe("clickHitsPoint", () => {
  it("accepts clicks on the control's outline with a little slack", () => {
    const framed = { ...point, frame: { x: 60, y: 40, width: 80, height: 20 } };
    expect(clickHitsPoint(framed, { x: 135, y: 58 })).toBe(true);
    expect(clickHitsPoint(framed, { x: 148, y: 66 })).toBe(true);
    expect(clickHitsPoint(framed, { x: 160, y: 50 })).toBe(false);
  });
  it("accepts clicks near a point without an outline", () => {
    expect(clickHitsPoint(point, { x: 120, y: 70 })).toBe(true);
    expect(clickHitsPoint(point, { x: 150, y: 50 })).toBe(false);
  });
});

describe("CompanionGuideStep", () => {
  it("forwards clicks only while waiting, and accepts the target once", async () => {
    const step = new CompanionGuideStep(point, 7, "conversation", false, vi.fn());
    await step.start();
    expect(invoke).toHaveBeenCalledWith("cursor_companion_watch_clicks", {
      turn: 7,
      watching: true,
    });
    expect(step.accepts({ turn: 6, x: 100, y: 50 })).toBe(false);
    expect(step.accepts({ turn: 7, x: 300, y: 300 })).toBe(false);
    expect(step.accepts({ turn: 7, x: 101, y: 51 })).toBe(true);
    expect(step.accepts({ turn: 7, x: 101, y: 51 })).toBe(false);
    expect(invoke).toHaveBeenLastCalledWith("cursor_companion_watch_clicks", {
      turn: 7,
      watching: false,
    });
  });
  it("stops waiting after a while", async () => {
    vi.useFakeTimers();
    const expire = vi.fn();
    await new CompanionGuideStep(point, 7, "conversation", true, expire).start();
    vi.advanceTimersByTime(GUIDE_WAIT_MS);
    expect(expire).toHaveBeenCalledOnce();
  });
});

it("asks for the next step with what was done", () => {
  expect(nextStepPrompt(point)).toBe(
    "I did step 1 of 3 (open Source Control). My screen is attached now; check it worked and show me the next step.",
  );
});
