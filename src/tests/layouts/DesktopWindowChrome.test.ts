import { describe, expect, it } from "vitest";

import { shouldSuppressWindowDrag } from "@/layouts/DesktopLayout/useDesktopWindowChrome";

describe("desktop window chrome drag suppression", () => {
  it("lets plain titlebar surfaces start a native window drag", () => {
    const titlebar = document.createElement("div");

    expect(shouldSuppressWindowDrag(titlebar)).toBe(false);
  });

  it("suppresses native window drag for controls and nested controls", () => {
    const shell = document.createElement("div");
    shell.innerHTML = "<span><button type=\"button\">Action</button></span>";

    expect(shouldSuppressWindowDrag(shell.querySelector("button"))).toBe(true);
  });

  it("suppresses native window drag for HTML reorder sources", () => {
    const tab = document.createElement("div");
    tab.draggable = true;

    expect(shouldSuppressWindowDrag(tab)).toBe(true);
  });

  it("suppresses native window drag inside marked pointer drag sources", () => {
    const card = document.createElement("article");
    card.dataset.mistyWindowDragBlock = "true";
    const title = document.createElement("span");
    card.append(title);

    expect(shouldSuppressWindowDrag(title)).toBe(true);
  });
});
