import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

const read = (name: string) => readFileSync(new URL(`../../src-tauri/src/infra/${name}.js`, import.meta.url), "utf8");

test("cursor follows dispatched actions, never stale targets, and does not intercept input", () => {
  const dom = new JSDOM('<button>Generate</button>', { url: "https://example.test", runScripts: "outside-only" });
  try {
    const w = dom.window;
    w.eval(read("browser_agent_cursor"));
    assert.equal(w.document.querySelector("misty-agent-cursor"), null);
    const button = w.document.querySelector("button")!;
    button.getBoundingClientRect = () => ({ left: 100, top: 200, width: 40, height: 20 } as DOMRect);
    let clicks = 0;
    button.addEventListener("click", () => clicks++);
    const inspect = () => w.eval(`(${read("browser_inspection_snapshot")})`)("nonce", 1000, 100);
    const click = (target: string) => w.eval(`(${read("browser_inspection_click")})`)(target);
    const stale = inspect().interactive[0].target;
    button.textContent = "Different";
    assert.equal(click(stale).ok, false);
    assert.equal(w.document.querySelector("misty-agent-cursor"), null);
    assert.equal(click(inspect().interactive[0].target).ok, true);
    assert.equal(clicks, 1);
    const cursor = w.document.querySelector("misty-agent-cursor") as HTMLElement;
    assert.equal(cursor.style.transform, "translate3d(118px,208px,0)");
    assert.equal(cursor.style.pointerEvents, "none");
    assert.equal(cursor.getAttribute("aria-hidden"), "true");
    w[Symbol.for("misty.browser.agent.cursor")].hide();
    assert.equal(cursor.style.opacity, "0");
  } finally { dom.window.close(); }
});

test("cursor respects reduced motion and ignores invalid coordinates", () => {
  const dom = new JSDOM("", { url: "https://example.test", runScripts: "outside-only" });
  try {
    const w = dom.window;
    w.matchMedia = () => ({ matches: true }) as MediaQueryList;
    w.eval(read("browser_agent_cursor"));
    const cursor = w[Symbol.for("misty.browser.agent.cursor")];
    cursor.move(NaN, 2);
    assert.equal(w.document.querySelector("misty-agent-cursor"), null);
    cursor.move(10, 10);
    cursor.move(100, 100);
    const host = w.document.querySelector("misty-agent-cursor") as HTMLElement;
    assert.equal(host.style.transition, "opacity 100ms");
    assert.equal(host.style.transform, "translate3d(98px,98px,0)");
    w.document.dispatchEvent(new w.Event("visibilitychange"));
    assert.equal(host.style.opacity, "0");
  } finally { dom.window.close(); }
});
