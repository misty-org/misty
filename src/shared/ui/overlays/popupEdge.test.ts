import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { popupSurfaceClass } from "./popupStyles";

/*
 * Popup corners once read as faint and cut off on 1x and scaled displays, more than once: the
 * edge was a ring (a box shadow outside the card that leaves a dark seam on the rounded corner)
 * or a colored border (painted under the contents, which thin it at the corners), with a drop
 * shadow darkening the page around it. A popup's edge is now only `popup-edge`, an outline over
 * the card's rim, and no popup casts a shadow. These checks keep it that way.
 */

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/** A drop shadow or a ring utility; `shadow-none` and focus rings on rows are not edges. */
const shadowOrRing = /(?<![\w:-])(?:shadow-(?!none\b)[\w[]|ring-(?:1|2|\[)|ring-cream)/;

describe("popup edges", () => {
  it("the popup surface draws its edge with popup-edge and casts no shadow", () => {
    expect(popupSurfaceClass.split(/\s+/)).toContain("popup-edge");
    expect(popupSurfaceClass).not.toMatch(shadowOrRing);
    expect(popupSurfaceClass).not.toMatch(/(?<![\w-])border(?:-|\b)/);
  });

  it("the global popup rule and popup-edge draw the same outline over a transparent border", () => {
    const edge = [
      "border: 1px solid transparent;",
      "outline: 1px solid color-mix(in srgb, currentColor 24%, transparent);",
      "outline-offset: -1px;",
    ];
    const overlays = read("src/styles/overlays.css");
    const utility = read("src/styles/components.css").match(/@utility popup-edge \{[^}]*\}/)?.[0];
    expect(utility).toBeTruthy();
    for (const line of edge) {
      expect(overlays).toContain(line);
      expect(utility).toContain(line);
    }
    // The global rule's first block is the popup chrome: no colored border, no shadow.
    const chrome = overlays.match(/\)\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(chrome).not.toMatch(/border:\s*1px solid (?!transparent)/);
    expect(chrome).toContain("box-shadow: none;");
  });

  it("no shared popup or dialog surface adds a shadow or a ring edge of its own", () => {
    const dir = resolve(root, "src/shared/ui/overlays");
    // The tour's spotlight and the floating picture-in-picture are not popup panels.
    const skip = new Set(["Tour.tsx", "FloatingPip.tsx"]);
    const offenders = readdirSync(dir)
      .filter((name) => name.endsWith(".tsx") && !name.includes(".test.") && !skip.has(name))
      .filter((name) => shadowOrRing.test(read(`src/shared/ui/overlays/${name}`)));
    expect(offenders).toEqual([]);
  });
});
