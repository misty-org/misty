import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

const contextMenuScript = readFileSync(
  new URL("../../src-tauri/src/infra/browser_context_menu.js", import.meta.url),
  "utf8",
);

function createTestPage(html = "<div><main>Hello world</main></div>") {
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://example.com/test" });
  const { window } = dom;

  const navigations: string[] = [];
  (window as unknown as { __testNavigations: string[] }).__testNavigations = navigations;
  const token = "secret-token-123";

  // In jsdom synthetic dispatchEvent has isTrusted=false. For testing in JSDOM,
  // allow synthetic events through while testing all other behavior.
  const testScript = contextMenuScript.replace(
    "if (!event.isTrusted) return;",
    "/* isTrusted simulated in test */",
  );

  const wrapped = `(() => {
    const shortcutToken = ${JSON.stringify(token)};
    const encode = encodeURIComponent;
    const stringify = JSON.stringify;
    const sendHostNavigation = (url) => window.__testNavigations.push(url);
    ${testScript}
  })();`;

  window.eval(wrapped);

  return { dom, window, navigations, token };
}

test("context menu opens on normal right click when no page handler prevents it", () => {
  const { dom, navigations, token } = createTestPage(
    "<main><p id='target'>Right click me</p></main>",
  );
  try {
    const target = dom.window.document.getElementById("target")!;
    const event = new dom.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
    });

    target.dispatchEvent(event);

    assert.equal(event.defaultPrevented, true, "default should be prevented to suppress native menu");
    assert.equal(navigations.length, 1, "should have sent one navigation");
    assert.match(navigations[0], /^misty-context-menu:open\?token=/);
    assert.match(navigations[0], new RegExp(token));
  } finally {
    dom.window.close();
  }
});

test("context menu is suppressed when page overrides contextmenu with preventDefault", () => {
  const { dom, navigations } = createTestPage(
    "<div id='chessboard'><div id='square'>e4</div></div>",
  );
  try {
    const board = dom.window.document.getElementById("chessboard")!;
    const square = dom.window.document.getElementById("square")!;

    // Page right click handler (like chess.com)
    let pageHandlerFired = false;
    board.addEventListener("contextmenu", (e) => {
      pageHandlerFired = true;
      e.preventDefault();
    });

    const event = new dom.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
    });

    square.dispatchEvent(event);

    assert.equal(pageHandlerFired, true, "page contextmenu listener should fire");
    assert.equal(event.defaultPrevented, true, "default should be prevented by the page");
    assert.equal(navigations.length, 0, "Misty context menu should NOT open when overridden");
  } finally {
    dom.window.close();
  }
});

test("context menu is suppressed when page prevents default on mousedown with button 2", () => {
  const { dom, navigations } = createTestPage(
    "<div id='canvas-app'><div id='canvas'>Canvas</div></div>",
  );
  try {
    const canvas = dom.window.document.getElementById("canvas")!;

    // App intercepts right click on mousedown/pointerdown
    canvas.addEventListener("mousedown", (e) => {
      if (e.button === 2) {
        e.preventDefault();
      }
    });

    const mouseDown = new dom.window.MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 2,
    });
    canvas.dispatchEvent(mouseDown);

    const contextEvent = new dom.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
    });
    canvas.dispatchEvent(contextEvent);

    assert.equal(navigations.length, 0, "Misty context menu should NOT open when right click was handled");
  } finally {
    dom.window.close();
  }
});

test("context menu is not opened on editable inputs to preserve native autofill/spellcheck", () => {
  const { dom, navigations } = createTestPage(
    "<form><input id='text-input' type='text' value='test' /></form>",
  );
  try {
    const input = dom.window.document.getElementById("text-input")!;
    const event = new dom.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
    });

    input.dispatchEvent(event);

    assert.equal(event.defaultPrevented, false, "default should not be prevented on editable inputs");
    assert.equal(navigations.length, 0, "Misty context menu should NOT open on editable inputs");
  } finally {
    dom.window.close();
  }
});
