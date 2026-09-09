import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

// Exercise the real initialization script: no separate viewport helper may
// change website scrolling, even when the user zooms the native WebView.
const rust = readFileSync(
  new URL("../src-tauri/src/infra/browser_scripts.rs", import.meta.url),
  "utf8",
);
const context = readFileSync(
  new URL("../src-tauri/src/infra/browser_context_menu.js", import.meta.url),
  "utf8",
);
const script = rust
  .match(/const BROWSER_VIEWPORT_SCRIPT: &str = r#"([\s\S]*?)"#;/)[1]
  .replace("__MISTY_CONTEXT_MENU_PLACEHOLDER__", context)
  .replace("__MISTY_CONTEXT_SEMANTIC_PLACEHOLDER__", "() => null")
  .replace("__MISTY_SHORTCUT_TOKEN_PLACEHOLDER__", '"test-token"')
  .replace("__MISTY_POINTER_TRACKING_PLACEHOLDER__", "false");

for (const overflow of ["auto", "hidden", "clip", "scroll"]) {
  test(`initialization preserves page-owned ${overflow} overflow and scrollbar styles`, () => {
    const page = new JSDOM(
      `<style>html,body { overflow-x:${overflow}; overflow-y:${overflow}; overscroll-behavior:contain; scrollbar-width:none; }</style><main>Page</main>`,
      { runScripts: "outside-only" },
    );
    try {
      const { window } = page,
        { document } = window;
      const before = document.documentElement.outerHTML;
      window.eval(script);
      assert.equal(document.documentElement.outerHTML, before);
      for (const node of [document.documentElement, document.body]) {
        const style = window.getComputedStyle(node);
        assert.equal(style.overflowX, overflow);
        assert.equal(style.overflowY, overflow);
        assert.equal(style.scrollbarWidth, "none");
      }
      assert.equal(document.querySelector("#misty-browser-horizontal-scrollbar"), null);
      assert.equal(window.__MISTY_SET_PAGE_ZOOM__, undefined);
    } finally {
      page.window.close();
    }
  });
}

test("animation changes and scrolling do not scan, reposition, or restyle the page", async () => {
  const page = new JSDOM(
    '<header style="position:fixed;transform:translateY(4px)">Header</header><main>Animated content</main>',
    { runScripts: "outside-only" },
  );
  try {
    const { window } = page,
      { document } = window;
    let scrollWrites = 0,
      scans = 0,
      timers = 0;
    window.scrollTo = () => scrollWrites++;
    window.scrollBy = () => scrollWrites++;
    window.getComputedStyle = () => {
      scans++;
      throw new Error("Unexpected style measurement");
    };
    window.setTimeout = () => {
      timers++;
      throw new Error("Unexpected viewport polling");
    };
    window.eval(script);
    const header = document.querySelector("header");
    for (let frame = 0; frame < 20; frame++) {
      header.style.transform = `translateY(${frame}px)`;
      document.querySelector("main").textContent = `Frame ${frame}`;
      window.dispatchEvent(new window.Event("scroll"));
      window.dispatchEvent(new window.Event("resize"));
      await Promise.resolve();
      assert.equal(header.style.transform, `translateY(${frame}px)`);
    }
    assert.equal(scans, 0);
    assert.equal(timers, 0);
    assert.equal(scrollWrites, 0);
    assert.equal(document.documentElement.hasAttribute("data-misty-horizontal-pan"), false);
  } finally {
    page.window.close();
  }
});

test("ordinary wheel and scrolling keys remain available to the page", () => {
  const page = new JSDOM('<main tabindex="0">Page</main>', { runScripts: "outside-only" });
  try {
    const { window } = page;
    window.eval(script);
    for (const event of [
      new window.WheelEvent("wheel", { deltaX: 40, deltaY: 80, bubbles: true, cancelable: true }),
      ...["ArrowDown", "ArrowRight", "PageDown", "Home", "End", " "].map(
        (key) => new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      ),
    ]) {
      window.document.querySelector("main").dispatchEvent(event);
      assert.equal(event.defaultPrevented, false);
    }
  } finally {
    page.window.close();
  }
});
