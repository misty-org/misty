// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { isTopEdgeDragPress } from "./windowChromeDrag";

/** A workspace pane as the app draws it: focusable itself, holding a page. */
function pane(inner: string): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("data-workspace-pane", "p1");
  root.tabIndex = 0;
  root.innerHTML = inner;
  document.body.append(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("dragging the window from a page's top edge", () => {
  it("moves the window from empty space at the top of a page in a pane", () => {
    const root = pane('<header><h2 id="title">Studio</h2></header>');
    expect(isTopEdgeDragPress({ clientY: 30, target: root.querySelector("#title") })).toBe(true);
  });

  it("leaves controls and focusable things inside the page alone", () => {
    const root = pane('<button id="b">Share</button><div id="f" tabindex="0">Item</div>');
    expect(isTopEdgeDragPress({ clientY: 20, target: root.querySelector("#b") })).toBe(false);
    expect(isTopEdgeDragPress({ clientY: 20, target: root.querySelector("#f") })).toBe(false);
  });

  it("keeps at least a 48px band, and nothing below it", () => {
    const root = pane('<p id="t">Text</p>');
    expect(isTopEdgeDragPress({ clientY: 46, target: root.querySelector("#t") })).toBe(true);
    expect(isTopEdgeDragPress({ clientY: 120, target: root.querySelector("#t") })).toBe(false);
  });
});
