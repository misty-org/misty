import assert from "node:assert/strict";
import { test } from "node:test";
import { checkMs, recoverDeadPages, stallMs, watchForDeadPage } from "./dead-page-watchdog.ts";

class FakeScript {}

/** A page with a hand-driven clock, interval and dev server. */
function fakePage(readyState = "loading") {
  let clock = 0;
  let tick: (() => void) | null = null;
  let arrive: () => void = () => {};
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const storage = new Map<string, string>();
  const state = { serverUp: true, probes: 0, reloads: 0 };
  const dataset: Record<string, string> = {};
  const page = {
    document: { readyState, documentElement: { dataset } },
    performance: { now: () => clock },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    HTMLScriptElement: FakeScript,
    PerformanceObserver: class {
      constructor(callback: () => void) {
        arrive = callback;
      }
      observe() {}
    },
    setInterval: (callback: () => void) => {
      tick = callback;
      return 1;
    },
    clearInterval: () => {
      tick = null;
    },
    fetch: async () => {
      state.probes++;
      if (!state.serverUp) throw new Error("connection refused");
      return { ok: true };
    },
    location: { href: "http://127.0.0.1:5173/", reload: () => void state.reloads++ },
  };
  watchForDeadPage(page as unknown as Window & typeof globalThis, stallMs, checkMs);
  return {
    state,
    dataset,
    storage,
    get watching() {
      return tick !== null;
    },
    fire: (type: string, event: unknown = {}) =>
      listeners.get(type)?.forEach((call) => call(event)),
    arrive: () => arrive(),
    /** Moves the clock in check-sized steps, letting each probe settle. */
    async advance(ms: number, eachStep?: () => void) {
      for (let passed = 0; passed < ms; passed += checkMs) {
        clock += checkMs;
        eachStep?.();
        tick?.();
        await new Promise((settle) => setImmediate(settle));
      }
    },
  };
}

test("a page that starts normally stops watching and never reloads", async () => {
  const page = fakePage();
  page.fire("DOMContentLoaded");
  await page.advance(checkMs);
  assert.equal(page.watching, false);
  assert.equal(page.state.reloads, 0);
});

test("a page whose scripts never arrived reloads once the server answers", async () => {
  const page = fakePage();
  page.state.serverUp = false;
  await page.advance(stallMs + 10_000);
  assert.ok(page.state.probes > 0);
  assert.equal(page.state.reloads, 0);
  page.state.serverUp = true;
  await page.advance(4_000);
  assert.equal(page.state.reloads, 1);
  assert.equal(page.storage.get("misty-dead-page-reloads"), "1");
});

test("a slow start that keeps receiving modules is left alone", async () => {
  const page = fakePage();
  page.dataset.mistyStarting = "";
  page.fire("DOMContentLoaded");
  await page.advance(90_000, () => page.arrive());
  assert.equal(page.state.reloads, 0);
  delete page.dataset.mistyStarting;
  await page.advance(checkMs);
  assert.equal(page.watching, false);
});

test("a start that stalls reloads, and one that keeps failing waits longer each time", async () => {
  const stalled = fakePage();
  stalled.dataset.mistyStarting = "";
  stalled.fire("DOMContentLoaded");
  await stalled.advance(stallMs + 4_000);
  assert.equal(stalled.state.reloads, 1);

  const failing = fakePage();
  failing.storage.set("misty-dead-page-reloads", "3");
  failing.dataset.mistyStartFailed = "";
  failing.fire("DOMContentLoaded");
  await failing.advance(14_000);
  assert.equal(failing.state.reloads, 0);
  await failing.advance(4_000);
  assert.equal(failing.state.reloads, 1);
});

test("a top-level script that failed to load counts as dead at once", async () => {
  const page = fakePage();
  page.fire("error", { target: new FakeScript() });
  page.fire("DOMContentLoaded");
  await page.advance(4_000);
  assert.equal(page.state.reloads, 1);
});

test("the watchdog goes into dev pages as a script that parses on its own", () => {
  const plugin = recoverDeadPages();
  assert.equal(plugin.apply, "serve");
  const transform = plugin.transformIndexHtml as unknown as () => Array<{
    children: string;
    injectTo: string;
  }>;
  const [tag] = transform();
  assert.equal(tag.injectTo, "head-prepend");
  assert.doesNotThrow(() => new Function(tag.children));
});
