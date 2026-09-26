import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const script = readFileSync(new URL("../../src-tauri/src/infra/browser_background.js", import.meta.url), "utf8");
test("native background reporting coalesces changes and sends only changed colors", () => {
  const reports: string[] = [];
  const timers = new Map<number, () => void>();
  let sequence = 0;
  let mutate!: () => void;
  let pixels = [32, 33, 36, 255];
  const painted: string[] = [];
  const context = {
    fillStyle: "", globalAlpha: 1,
    fillRect() { painted.push(this.fillStyle); },
    getImageData: () => ({ data: new Uint8ClampedArray(pixels) }),
  };
  const window: Record<string, unknown> = {
    webkit: { messageHandlers: { mistyFocus: { postMessage: (value: string) => reports.push(value) } } },
  };
  window.top = window;
  runInNewContext(script, {
    window, shortcutToken: "test-token", innerWidth: 1000, innerHeight: 700,
    document: {
      body: {},
      createElement: () => ({ getContext: () => context }),
      elementsFromPoint: () => [{ closest: () => null }],
    },
    getComputedStyle: () => ({ backgroundColor: "rgb(32, 33, 36)" }),
    MutationObserver: class {
      constructor(callback: () => void) { mutate = callback; }
      observe() {}
    },
    addEventListener() {},
    matchMedia: () => ({ addEventListener() {} }),
    setTimeout: (callback: () => void) => { timers.set(++sequence, callback); return sequence; },
    clearTimeout: (id: number) => timers.delete(id),
  });
  const flush = () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); };
  for (let i = 0; i < 100; i++) mutate();
  assert.equal(timers.size, 1);
  assert.equal(reports.length, 0);
  flush();
  assert.deepEqual(JSON.parse(reports[0]), { token: "test-token", background: "#202124" });
  assert.deepEqual(painted, ["#ffffff", "rgb(32, 33, 36)"]);
  mutate(); flush();
  assert.equal(reports.length, 1);
  pixels = [255, 255, 255, 255];
  mutate(); flush();
  assert.equal(JSON.parse(reports[1]).background, "#ffffff");
});
test("subframes cannot report the containing page's background", () => {
  runInNewContext(script, { window: { top: {} } });
});
