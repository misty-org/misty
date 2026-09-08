import { afterEach, describe, expect, it, vi } from "vitest";
import { findControls, placeControls } from "./mistyControls";
import type { DisplayCapture } from "./protocol";

function capture(screen: string, x: number, width: number, pixels: number): DisplayCapture {
  return {
    id: screen,
    name: screen,
    mimeType: "image/jpeg",
    dataUrl: "data:image/jpeg;base64,",
    width: pixels,
    height: pixels / 2,
    contentHash: "",
    screen,
    primary: screen === "screen1",
    display: { id: 1, x, y: 0, width, height: width / 2, scale: 2 },
  } as DisplayCapture;
}

const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
});

describe("placeControls", () => {
  it("maps CSS pixels through the window origin, zoom and capture scale", () => {
    const [first, second] = placeControls(
      [
        { label: "Manage virtual windows", role: "button", rect: rect(100, 10, 24, 24) },
        { label: "Settings", role: "button", rect: rect(1500, 400, 20, 20) },
      ],
      { x: 0, y: 0, unit: 1.1 },
      [capture("screen1", 0, 1512, 1512), capture("screen2", 1512, 1000, 2000)],
    );
    // 100 + 12 CSS px at 1.1 points each; screen1 captures one pixel per point.
    expect(first.controls).toEqual([
      { label: "Manage virtual windows", role: "button", x: 123, y: 24, width: 26, height: 26 },
    ]);
    // 1510 CSS px * 1.1 = 1661 points, 149 into screen2, which captures 2 pixels per point.
    expect(second.controls?.[0]).toMatchObject({ label: "Settings", x: 298, y: 902 });
  });

  it("leaves captures without Misty controls unchanged", () => {
    const screens = [capture("screen1", 0, 1000, 1000)];
    const placed = placeControls(
      [{ label: "Back", role: "button", rect: rect(5000, 10, 20, 20) }],
      { x: 0, y: 0, unit: 1 },
      screens,
    );
    expect(placed[0]).toBe(screens[0]);
  });
});

describe("findControls", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("names visible controls and skips hidden, disabled and private ones", () => {
    document.body.innerHTML = `
      <button aria-label="New tab"></button>
      <button title="Split right"></button>
      <a href="/x">  Open   history </a>
      <button disabled aria-label="Disabled"></button>
      <div aria-hidden="true"><button aria-label="Hidden"></button></div>
      <button title="Bank login"><svg aria-label="Private tab"></svg></button>
      <input placeholder="Search or enter address" />
    `;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 10, y: 10, width: 24, height: 24 }),
    );
    expect(findControls(document).map(({ label, role }) => `${role}:${label}`)).toEqual([
      "button:New tab",
      "button:Split right",
      "link:Open history",
      "button:Private tab",
      "textbox:Search or enter address",
    ]);
  });

  it("marks controls that stay transparent until hovered", () => {
    document.body.innerHTML = `<button aria-label="Close pane"></button>`;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 10, y: 10, width: 24, height: 24 }),
    );
    const button = document.querySelector("button")!;
    button.checkVisibility = (options?: CheckVisibilityOptions) => !options?.opacityProperty;
    const [control] = findControls(document);
    expect(control).toMatchObject({ label: "Close pane", hover: true });
    expect(
      placeControls([control], { x: 0, y: 0, unit: 1 }, [capture("screen1", 0, 1000, 1000)])[0]
        .controls?.[0].reveal,
    ).toBe("hover");
  });
});
