import { afterEach, expect, it, vi } from "vitest";
import { windowSurfaceBackground } from "./windowSurfaceBackground";

function surface(background: string) {
  const element = document.createElement("div");
  element.style.backgroundColor = background;
  document.body.append(element);
  return element;
}
function hitStack(elements: Element[]) {
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: vi.fn(() => elements),
  });
}
afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(document, "elementsFromPoint");
});

it("matches the visible surface instead of the default theme background", () => {
  hitStack([surface("#191919"), surface("#131313")]);
  expect(windowSurfaceBackground("#131313")).toBe("#191919");
  expect(document.elementsFromPoint).toHaveBeenCalledWith(
    window.innerWidth - 24,
    window.innerHeight / 2,
  );
});
it("looks through transparent content to the enclosing surface", () => {
  hitStack([surface("transparent"), surface("#f5f2ec")]);
  expect(windowSurfaceBackground("#131313")).toBe("#f5f2ec");
});
it("blends translucent overlays over the visible surface", () => {
  hitStack([surface("rgba(0, 0, 0, 0.5)"), surface("#808080")]);
  expect(windowSurfaceBackground("#131313")).toBe("#404040");
});
it("uses the theme behind transparent native browser hosts", () => {
  hitStack([surface("transparent")]);
  expect(windowSurfaceBackground("#131313")).toBe("#131313");
});
it("falls back before a surface is mounted", () => {
  hitStack([]);
  expect(windowSurfaceBackground("#F5F2EC")).toBe("#f5f2ec");
});

it("uses the website's reported color through a transparent browser host", () => {
  const host = surface("transparent");
  host.setAttribute("data-browser-page-host", "");
  host.dataset.mistyBrowserBackground = "#202124";
  hitStack([host, surface("#131313")]);
  expect(windowSurfaceBackground("#131313")).toBe("#202124");
});
it("lets an opaque shell overlay cover the website color", () => {
  const host = surface("transparent");
  host.setAttribute("data-browser-page-host", "");
  host.dataset.mistyBrowserBackground = "#202124";
  hitStack([surface("#191919"), host, surface("#131313")]);
  expect(windowSurfaceBackground("#131313")).toBe("#191919");
});
it("does not reuse a website color after its host is hidden or replaced", () => {
  const host = surface("transparent");
  host.setAttribute("data-browser-page-host", "");
  host.dataset.mistyBrowserBackground = "#202124";
  hitStack([host]);
  expect(windowSurfaceBackground("#131313")).toBe("#202124");
  hitStack([surface("#f5f2ec")]);
  expect(windowSurfaceBackground("#131313")).toBe("#f5f2ec");
});
