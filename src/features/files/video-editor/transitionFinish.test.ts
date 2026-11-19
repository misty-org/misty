import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import type * as LookModule from "@opencut/look/transitions";

const require = createRequire(import.meta.url);
let look: typeof LookModule;
let ticksPerSecond: number;

beforeAll(async () => {
  const { loadOpencutWasm } = await import("@opencut/wasm/load");
  await loadOpencutWasm(readFileSync(require.resolve("opencut-wasm/opencut_wasm_bg.wasm")));
  look = await import("@opencut/look/transitions");
  ticksPerSecond = (await import("@opencut/wasm")).TICKS_PER_SECOND;
});

const at = (seconds: number) => seconds * ticksPerSecond;
const still = { scaleX: 1, scaleY: 1, position: { x: 0, y: 0 }, rotate: 0 };
const canvas = { width: 1920, height: 1080 };

function stateAt(params: Record<string, string | number>, seconds: number, length = 4) {
  return look.applyTransitions({
    transitions: look.readTransitions(params),
    localTicks: at(seconds),
    durationTicks: at(length),
    transform: still,
    opacity: 1,
    canvas,
  });
}

describe("dips and wipes", () => {
  it("are offered in the Transitions tab", () => {
    const kinds = look.TRANSITION_KINDS.map((kind) => kind.value);
    expect(kinds).toEqual(
      expect.arrayContaining(["dip-black", "dip-white", "wipe-left", "wipe-right"]),
    );
  });

  it("dips in from black and out to white, leaving the clip's opacity alone", () => {
    const params = {
      "transition.in": "dip-black",
      "transition.out": "dip-white",
      "transition.inDuration": 1,
      "transition.outDuration": 1,
    };
    expect(stateAt(params, 0).finish?.dip).toEqual({ color: "black", amount: 1 });
    expect(stateAt(params, 0).opacity).toBe(1);
    expect(stateAt(params, 0.5).finish?.dip?.amount).toBeCloseTo(0.5);
    expect(stateAt(params, 2).finish).toBeNull();
    expect(stateAt(params, 4).finish?.dip).toEqual({ color: "white", amount: 1 });
  });

  it("wipes on from the side it names and off the same way", () => {
    const coming = { "transition.in": "wipe-left", "transition.inDuration": 1 };
    expect(stateAt(coming, 0).finish?.wipe).toEqual({ left: 0, right: 0 });
    expect(stateAt(coming, 0.5).finish?.wipe).toEqual({ left: 0, right: 0.5 });
    const going = { "transition.out": "wipe-left", "transition.outDuration": 1 };
    // Its edge keeps moving rightwards, covering the clip from the left.
    expect(stateAt(going, 3.5).finish?.wipe).toEqual({ left: 0.5, right: 1 });
    const fromRight = { "transition.in": "wipe-right", "transition.inDuration": 1 };
    expect(stateAt(fromRight, 0.5).finish?.wipe).toEqual({ left: 0.5, right: 1 });
  });

  it("shows only what both wipes show on a clip too short for them apart", () => {
    const state = stateAt(
      {
        "transition.in": "wipe-left",
        "transition.out": "wipe-left",
        "transition.inDuration": 1,
        "transition.outDuration": 1,
      },
      0.5,
      1,
    );
    expect(state.finish?.wipe).toEqual({ left: 0.5, right: 0.5 });
  });

  it("keys each finish by what it draws, and mirrors a wipe for a flipped clip", () => {
    const finish = { dip: null, wipe: { left: 0, right: 0.25 } };
    expect(look.transitionFinishKey(null)).toBeUndefined();
    expect(look.transitionFinishKey(finish)).not.toBe(
      look.transitionFinishKey({ ...finish, wipe: { left: 0, right: 0.5 } }),
    );
    expect(look.mirrorTransitionFinish(finish).wipe).toEqual({ left: 0.75, right: 1 });
  });

  it("draws a dip over the clip's pixels and clears what a wipe hides", () => {
    const calls: string[] = [];
    const ctx: {
      save(): void;
      restore(): void;
      fillRect(x: number, y: number, w: number, h: number): void;
      clearRect(x: number, y: number, w: number, h: number): void;
      fillStyle: string;
      globalAlpha: number;
      globalCompositeOperation: string;
    } = {
      save: () => void calls.push("save"),
      restore: () => void calls.push("restore"),
      fillRect: (x: number, y: number, w: number, h: number) => {
        const how = `${ctx.fillStyle} ${ctx.globalAlpha} ${ctx.globalCompositeOperation}`;
        calls.push(`fill ${how} ${x},${y},${w},${h}`);
      },
      clearRect: (x: number, y: number, w: number, h: number) =>
        void calls.push(`clear ${x},${y},${w},${h}`),
      fillStyle: "",
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
    };
    look.drawTransitionFinish({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      width: 100,
      height: 50,
      finish: { dip: { color: "white", amount: 0.5 }, wipe: { left: 0.25, right: 0.75 } },
    });
    expect(calls).toEqual([
      "save",
      "fill #ffffff 0.5 source-atop 0,0,100,50",
      "restore",
      "clear 0,0,25,50",
      "clear 75,0,25,50",
    ]);
  });
});
