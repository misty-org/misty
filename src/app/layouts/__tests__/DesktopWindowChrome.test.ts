import { describe, expect, it } from "vitest";

import { shouldSuppressWindowDrag } from "@/app/layouts/DesktopLayout/useDesktopWindowChrome";

describe("desktop window chrome drag suppression", () => {
  it("lets plain titlebar surfaces start a native window drag", () => {
    const titlebar = document.createElement("div");

    expect(shouldSuppressWindowDrag(titlebar)).toBe(false);
  });

  it("suppresses native window drag for controls and nested controls", () => {
    const shell = document.createElement("div");
    shell.innerHTML = '<span><button type="button">Action</button></span>';

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

  it("suppresses native window drag from BlockNote drag handles", () => {
    const sideMenu = document.createElement("div");
    sideMenu.className = "bn-side-menu";
    const handle = document.createElement("button");
    handle.draggable = true;
    sideMenu.append(handle);

    expect(shouldSuppressWindowDrag(handle)).toBe(true);
  });

  it("suppresses native window drag from current BlockNote side-menu handles", () => {
    const editor = document.createElement("div");
    editor.className = "bn-container";
    const block = document.createElement("div");
    block.className = "bn-block-outer";
    const sideMenu = document.createElement("div");
    sideMenu.className = "bn-side-menu";
    const handle = document.createElement("div");
    handle.dataset.dragHandle = "true";
    sideMenu.append(handle);
    editor.append(block, sideMenu);

    expect(shouldSuppressWindowDrag(handle)).toBe(true);
    expect(shouldSuppressWindowDrag(block)).toBe(true);
  });
});
