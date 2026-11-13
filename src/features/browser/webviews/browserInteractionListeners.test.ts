import { describe, expect, it } from "vitest";
import { rendererPointer } from "./browserInteractionListeners";

describe("rendererPointer", () => {
  it("undoes the app's zoom", () => {
    expect(rendererPointer({ x: 300, y: 150, inside: true }, 1.5)).toEqual({ x: 200, y: 100 });
  });

  it("takes the window's points as they are at no zoom", () => {
    expect(rendererPointer({ x: 12, y: 8, inside: true }, 1)).toEqual({ x: 12, y: 8 });
    expect(rendererPointer({ x: 12, y: 8, inside: true }, Number.NaN)).toEqual({ x: 12, y: 8 });
  });

  it("reports nothing once the pointer has left the page", () => {
    expect(rendererPointer({ x: 0, y: 0, inside: false }, 1)).toBeNull();
    expect(rendererPointer({ x: Number.NaN, y: 4, inside: true }, 1)).toBeNull();
  });
});
