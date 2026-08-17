import { describe, expect, it } from "vitest";

import {
  shouldSuppressWindowDrag,
  windowRectsMatch,
} from "@/application/layouts/DesktopLayout/useDesktopWindowChrome";

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

describe("desktop window zoom geometry", () => {
  const workArea = { x: 0, y: 29, width: 1496, height: 938 };

  it("recognizes a window that actually fills the monitor work area", () => {
    expect(windowRectsMatch(workArea, workArea)).toBe(true);
  });

  it("allows small native frame-rounding differences", () => {
    expect(windowRectsMatch({ x: 1, y: 28, width: 1494, height: 940 }, workArea)).toBe(true);
  });

  it("does not mistake a remembered smaller frame for an expanded window", () => {
    expect(windowRectsMatch({ x: 108, y: 59, width: 1280, height: 820 }, workArea)).toBe(false);
  });
});
