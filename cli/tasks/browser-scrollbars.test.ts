import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

const css = readFileSync(new URL("../../src/styles/scrollbars.css", import.meta.url), "utf8");
const script = readFileSync(
  new URL("../../src-tauri/src/infra/browser_scrollbars.js", import.meta.url),
  "utf8",
).replace("__MISTY_SCROLLBAR_CSS_PLACEHOLDER__", JSON.stringify(css));

// jsdom has no matchMedia; every WebView the script runs in does.
function webviewPage(html: string): JSDOM {
  const page = new JSDOM(html, { runScripts: "outside-only" });
  Object.assign(page.window, {
    matchMedia: (media: string) => ({
      matches: false,
      media,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  return page;
}

test("embedded scrollbar styling installs once and leaves page scrolling alone", () => {
  const page = webviewPage('<main style="overflow:hidden;scrollbar-width:none">Page</main>');
  try {
    const { window } = page;
    const main = window.document.querySelector("main")!;
    const before = main.outerHTML;
    window.eval(script);
    window.eval(script);
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
    assert.equal(window.document.querySelectorAll("#misty-browser-scrollbars").length, 1);
    assert.equal(window.document.getElementById("misty-browser-scrollbars")!.textContent, css);
    assert.equal(main.outerHTML, before);
    assert.equal(window.getComputedStyle(main).overflow, "hidden");
    assert.equal(window.getComputedStyle(main).scrollbarWidth, "none");
  } finally {
    page.window.close();
  }
});

test("document-start installation recovers when the parser creates the root", () => {
  const page = webviewPage("");
  try {
    const { window } = page;
    const { document } = window;
    document.documentElement.remove();
    window.eval(script);
    assert.equal(document.getElementById("misty-browser-scrollbars"), null);
    document.appendChild(document.createElement("html"));
    document.dispatchEvent(new window.Event("DOMContentLoaded"));
    assert.equal(document.getElementById("misty-browser-scrollbars")!.textContent, css);
  } finally {
    page.window.close();
  }
});

test("a replaced parser head gets the shared stylesheet again", () => {
  const page = webviewPage("");
  try {
    const { window } = page;
    window.eval(script);
    window.document.head.replaceWith(window.document.createElement("head"));
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
    assert.equal(window.document.getElementById("misty-browser-scrollbars")!.textContent, css);
  } finally {
    page.window.close();
  }
});
