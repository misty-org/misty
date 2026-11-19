import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

import type * as LookModule from "@opencut/look/transitions";
import type * as AdjustModule from "@opencut/look/adjust";

type Look = typeof LookModule;
type Adjust = typeof AdjustModule;
let look: Look;
let adjust: Adjust;
let ticksPerSecond: number;

beforeAll(async () => {
  const { loadOpencutWasm } = await import("@opencut/wasm/load");
  await loadOpencutWasm(readFileSync(require.resolve("opencut-wasm/opencut_wasm_bg.wasm")));
  look = await import("@opencut/look/transitions");
  adjust = await import("@opencut/look/adjust");
  ticksPerSecond = (await import("@opencut/wasm")).TICKS_PER_SECOND;
});

const at = (seconds: number) => seconds * ticksPerSecond;
const still = { scaleX: 1, scaleY: 1, position: { x: 0, y: 0 }, rotate: 0 };
const canvas = { width: 1920, height: 1080 };

describe("a clip's transitions", () => {
  it("reads none from a clip that has none", () => {
    expect(look.readTransitions({})).toBeUndefined();
    expect(look.readTransitions({ "transition.in": "sideways" })).toBeUndefined();
  });

  it("fades in over its length and is fully shown after", () => {
    const transitions = look.readTransitions({
      "transition.in": "fade",
      "transition.inDuration": 1,
    });
    const state = (seconds: number) =>
      look.applyTransitions({
        transitions,
        localTicks: at(seconds),
        durationTicks: at(4),
        transform: still,
        opacity: 1,
        canvas,
      });
    expect(state(0).opacity).toBe(0);
    expect(state(0.5).opacity).toBeCloseTo(0.5);
    expect(state(1).opacity).toBe(1);
    expect(state(3.9).opacity).toBe(1);
  });

  it("slides in from each side and out the same way at the end", () => {
    const from = (kind: string) =>
      look.applyTransitions({
        transitions: look.readTransitions({ "transition.in": kind }),
        localTicks: 0,
        durationTicks: at(4),
        transform: still,
        opacity: 1,
        canvas,
      }).transform.position;
    expect(from("slide-left")).toEqual({ x: -1920, y: 0 });
    expect(from("slide-right")).toEqual({ x: 1920, y: 0 });
    expect(from("slide-up")).toEqual({ x: 0, y: 1080 });
    expect(from("slide-down")).toEqual({ x: 0, y: -1080 });
    const leaving = look.applyTransitions({
      transitions: look.readTransitions({ "transition.out": "slide-left" }),
      localTicks: at(4),
      durationTicks: at(4),
      transform: still,
      opacity: 1,
      canvas,
    });
    expect(leaving.transform.position.x).toBe(-1920);
  });

  it("zooms and focuses in from smaller and blurred", () => {
    const zoom = look.applyTransitions({
      transitions: look.readTransitions({ "transition.in": "zoom" }),
      localTicks: 0,
      durationTicks: at(4),
      transform: still,
      opacity: 1,
      canvas,
    });
    expect(zoom.transform.scaleX).toBeCloseTo(0.6);
    expect(zoom.opacity).toBe(0);
    const focus = look.applyTransitions({
      transitions: look.readTransitions({ "transition.in": "blur" }),
      localTicks: 0,
      durationTicks: at(4),
      transform: still,
      opacity: 1,
      canvas,
    });
    expect(focus.blur).toBe(40);
  });

  it("runs both on a clip shorter than the two together", () => {
    const state = look.applyTransitions({
      transitions: look.readTransitions({
        "transition.in": "fade",
        "transition.out": "fade",
        "transition.inDuration": 1,
        "transition.outDuration": 1,
      }),
      localTicks: at(0.5),
      durationTicks: at(1),
      transform: still,
      opacity: 1,
      canvas,
    });
    expect(state.opacity).toBeCloseTo(0.25);
  });
});

describe("a clip's color adjustments", () => {
  it("reads each adjustment, rest at zero", () => {
    expect(adjust.readAdjust({})).toEqual(adjust.NEUTRAL_ADJUST);
    expect(adjust.isNeutralAdjust(adjust.readAdjust({}))).toBe(true);
    const set = adjust.readAdjust({ "adjust.exposure": -2, "adjust.saturation": 0.5 });
    expect(set.exposure).toBe(-2);
    expect(set.saturation).toBe(0.5);
    expect(adjust.isNeutralAdjust(set)).toBe(false);
  });

  it("changes its cache key whenever an adjustment changes", () => {
    const a = adjust.adjustKey({ ...adjust.NEUTRAL_ADJUST, warmth: 0.2 });
    const b = adjust.adjustKey({ ...adjust.NEUTRAL_ADJUST, warmth: 0.21 });
    expect(a).not.toBe(b);
  });

  it("is offered on videos and photos, and transitions on every visual clip", async () => {
    const { getBuiltInElementParams } = await import("@opencut/params/registry");
    const keys = (type: "video" | "image" | "text" | "audio") =>
      getBuiltInElementParams({ type }).map((param) => param.key);
    expect(keys("video")).toEqual(
      expect.arrayContaining([...adjust.ADJUST_KEYS, ...look.TRANSITION_KEYS]),
    );
    expect(keys("image")).toEqual(expect.arrayContaining([...adjust.ADJUST_KEYS]));
    expect(keys("text")).toEqual(expect.arrayContaining([...look.TRANSITION_KEYS]));
    expect(keys("text")).not.toContain("adjust.exposure");
    expect(keys("audio")).not.toContain("transition.in");
  });
});
