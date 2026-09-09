import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
const source = readFileSync(
  `${process.cwd()}/src-tauri/src/infra/browser_default_context_menu.js`,
  "utf8",
);
afterEach(() => {
  document.body.innerHTML = "";
});

function surface(label?: string) {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const view = frame.contentWindow!;
  Object.assign(view, {
    __TAURI_INTERNALS__: label ? { metadata: { currentWebview: { label } } } : undefined,
  });
  Function("window", source)(view);
  const target = view.document.createElement("div");
  view.document.body.append(target);
  return {
    target,
    contextmenu: () => {
      const event = view.document.createEvent("MouseEvent");
      event.initEvent("contextmenu", true, true);
      return { event, allowed: target.dispatchEvent(event) };
    },
  };
}
it("suppresses the website fallback even when website code stops propagation", () => {
  const page = surface("misty-browser-tab-pilot");
  let reached = false;
  page.target.addEventListener("contextmenu", (event) => {
    reached = true;
    event.stopImmediatePropagation();
  });
  expect(page.contextmenu().allowed).toBe(false);
  expect(reached).toBe(true);
});
it("suppresses menus in frames without granting a bridge or reading page content", () => {
  expect(surface().contextmenu().allowed).toBe(false);
});
it("lets shell custom menus run before canceling the default menu", () => {
  const host = surface("main");
  let customMenuOpened = false;
  host.target.addEventListener("contextmenu", (event) => {
    if (!event.defaultPrevented) customMenuOpened = true;
  });
  expect(host.contextmenu().allowed).toBe(false);
  expect(customMenuOpened).toBe(true);
});
it("cancels the shell fallback where there is no custom menu", () => {
  expect(surface("main").contextmenu().allowed).toBe(false);
});
it("does not block other browser interactions", () => {
  const page = surface("misty-browser-tab-pilot");
  for (const type of ["click", "pointerdown", "keydown"]) {
    const event = page.target.ownerDocument.createEvent("Event");
    event.initEvent(type, true, true);
    expect(page.target.dispatchEvent(event)).toBe(true);
  }
});
