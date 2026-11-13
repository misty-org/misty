import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ENGINE_IDS } from "@/features/engine-config/channels/engines";
import { EngineMark } from "@/features/engine-config/EngineMark";
import { BrandMark } from "@/features/engine-config/brands/BrandMark";
import engineMarks from "@/features/engine-config/engineMarks.json";
import brandMarks from "@/features/engine-config/brands/brandMarks.json";
import {
  PI_FAMILY_APIKEY_PROVIDERS,
  PI_FAMILY_OAUTH_PROVIDERS,
} from "@/features/engine-config/engine-setup/piFamilyAuthCatalog";
import { BrandIcon, adaptiveMarks, logoPlates } from "@/shared/ui";
import { repositoryRoot } from "./repositoryPolicy";

/**
 * Every third-party logo is the brand's own artwork, reads on both themes, and is never blank
 * (AGENTS.md). A logo that fails here needs its brand's colored or theme variant, and only when the
 * brand has none, an entry in `logoPlates`.
 */

const brandIconFolder = resolve(repositoryRoot, "src/shared/ui/icons/brand-icons");
const DARK = "#131313";
const LIGHT = "#ffffff";
/** Below this a logo's best color is all but invisible on the background. */
const MIN_CONTRAST = 1.6;

type Shape = [string, Record<string, string>, Shape[]?];
type Mark = [Record<string, string>, Shape[]];

const named: Record<string, string | null> = {
  black: "#000000",
  white: "#ffffff",
  none: null,
  transparent: null,
};

/** A paint as `#rrggbb`, `theme` for one that follows the text color, or null for none. */
function paint(value: string): string | null {
  const color = value.trim().toLowerCase();
  if (color in named) return named[color];
  if (color === "currentcolor" || color === "inherit") return "theme";
  if (color.startsWith("url(")) return null;
  const short = /^#([0-9a-f]{3})$/.exec(color);
  if (short) return `#${[...short[1]].map((digit) => digit + digit).join("")}`;
  const long = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(color);
  if (long) return `#${long[1]}`;
  const rgb = /^rgba?\(([^)]*)\)$/.exec(color);
  if (rgb) {
    const [r, g, b] = rgb[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    return `#${[r, g, b].map((part) => Math.round(part).toString(16).padStart(2, "0")).join("")}`;
  }
  return null;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

interface Logo {
  key: string;
  paints: (string | null)[];
}

function svgPaints(text: string): (string | null)[] {
  const paints = [...text.matchAll(/(?:fill|stroke|stop-color)\s*[=:]\s*"?([^";>]+)"?/g)].map(
    (match) => paint(match[1]),
  );
  // SVG paints a shape black when nothing says otherwise.
  return /fill\s*[=:]/.test(text) ? paints : [...paints, "#000000"];
}

function markPaints(mark: Mark): (string | null)[] {
  const paints: (string | null)[] = [];
  const visit = (attributes: Record<string, string>, children: Shape[] = []) => {
    for (const name of ["fill", "stroke", "stopColor", "color"])
      if (attributes[name]) paints.push(paint(attributes[name]));
    for (const [, childAttributes, grandchildren] of children)
      visit(childAttributes, grandchildren);
  };
  visit(mark[0], mark[1]);
  return paints.length ? paints : ["#000000"];
}

const brandSvgs = readdirSync(brandIconFolder)
  .filter((file) => file.endsWith(".svg"))
  .map((file) => ({
    id: file.slice(0, -4),
    text: readFileSync(resolve(brandIconFolder, file), "utf8"),
  }));

const logos: Logo[] = [
  ...brandSvgs
    .filter(({ id }) => !adaptiveMarks.has(id))
    .map(({ id, text }) => ({ key: `brand:${id}`, paints: svgPaints(text) })),
  ...Object.entries(engineMarks as unknown as Record<string, Mark>).map(([id, mark]) => ({
    key: `engine:${id}`,
    paints: markPaints(mark),
  })),
  ...Object.entries(brandMarks as unknown as Record<string, Mark>).map(([id, mark]) => ({
    key: `provider:${id}`,
    paints: markPaints(mark),
  })),
];

/**
 * How a logo fares on each theme: `gone` when even its strongest color all but disappears, `partly`
 * when some part does (a dark wordmark beside a bright symbol). A logo with any part in the text
 * color follows the theme and never does.
 */
function themeFit(logo: Logo, background: string): "fine" | "partly" | "gone" {
  if (logo.paints.includes("theme")) return "fine";
  const colors = logo.paints.filter((color): color is string => Boolean(color));
  if (!colors.length) return "fine";
  const contrasts = colors.map((color) => contrast(color, background));
  if (Math.max(...contrasts) < MIN_CONTRAST) return "gone";
  return Math.min(...contrasts) < MIN_CONTRAST ? "partly" : "fine";
}

afterEach(cleanup);

describe("logo artwork", () => {
  it("reads on both themes, on a plate only where the brand has no variant that does", () => {
    const problems: string[] = [];
    for (const logo of logos) {
      const fit = { dark: themeFit(logo, DARK), light: themeFit(logo, LIGHT) };
      const plate = logoPlates[logo.key];
      if (fit.dark === "gone" && fit.light === "gone")
        problems.push(`${logo.key}: invisible on both themes`);
      for (const theme of ["dark", "light"] as const)
        if (fit[theme] === "gone" && plate !== theme)
          problems.push(`${logo.key}: disappears on the ${theme} theme; use the brand's variant`);
      // A plate is the last resort, for a logo that at least partly disappears on its theme.
      if (plate && fit[plate] === "fine")
        problems.push(
          `${logo.key}: on a ${plate} plate it doesn't need; remove it from logoPlates`,
        );
    }
    for (const key of Object.keys(logoPlates))
      if (!logos.some((logo) => logo.key === key)) problems.push(`${key}: plate for no logo`);
    expect(problems).toEqual([]);
  });

  it("never follows the system's theme in place of the app's", () => {
    // An SVG's own media query reads the OS setting, which can differ from the app's theme.
    const following = brandSvgs.filter(({ text }) => /@media/.test(text)).map(({ id }) => id);
    expect(following.filter((id) => !adaptiveMarks.has(id))).toEqual([]);
  });

  it("gives every engine Misty can run its own mark", () => {
    const native = [
      ...readFileSync(resolve(repositoryRoot, "src-tauri/features/engines/mod.rs"), "utf8")
        .split("pub fn engine_by_id")[1]
        .split("\n}\n")[0]
        .matchAll(/"([a-z0-9-]+)" =>/g),
    ].map((match) => match[1]);
    const engines = new Set([...ENGINE_IDS, ...native]);
    const missing = [...engines].filter((id) => id !== "misty" && !(id in engineMarks));
    expect(missing).toEqual([]);
  });

  it("names every sign-in provider with its brand's mark, except ones with no public mark", () => {
    const providers = [
      ...PI_FAMILY_APIKEY_PROVIDERS,
      ...PI_FAMILY_OAUTH_PROVIDERS.pi,
      ...PI_FAMILY_OAUTH_PROVIDERS.omp,
    ];
    const withoutMark = new Set(providers.filter((item) => !item.mark).map((item) => item.id));
    expect([...withoutMark]).toEqual(["radius"]);
  });

  it("never renders a blank logo", () => {
    const shown = (element: ReactElement) => {
      const { container } = render(element);
      const filled = Boolean(container.firstElementChild);
      cleanup();
      return filled;
    };
    expect(shown(<BrandIcon brand="no-such-brand" />)).toBe(true);
    expect(shown(<EngineMark engine="no-such-engine" />)).toBe(true);
    expect(shown(<EngineMark engine="misty" />)).toBe(true);
    expect(shown(<BrandMark mark="no-such-mark" />)).toBe(true);
    expect(shown(<BrandMark mark={null} />)).toBe(true);
  });
});
