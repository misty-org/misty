import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ENGINE_IDS } from "@/features/engine-config/channels/engines";
import { PRESETS } from "@/features/engine-config/channels/provider_presets";
import {
  PI_FAMILY_APIKEY_PROVIDERS,
  PI_FAMILY_OAUTH_PROVIDERS,
} from "@/features/engine-config/engine-setup/pi_family_auth_catalog";
import { Mark, hasMark, markFor, marks, type MarkRender } from "@misty/ui";
import { repositoryRoot } from "./repository_policy";

const markFolder = resolve(repositoryRoot, "node_modules/@misty/ui/src/icons/marks");
const DARK = "#131313";
const LIGHT = "#ffffff";
const MIN_CONTRAST = 1.6;

const named: Record<string, string | null> = {
  black: "#000000",
  white: "#ffffff",
  none: null,
  transparent: null,
};

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
  return /fill\s*[=:]/.test(text) ? paints : [...paints, "#000000"];
}

const markSvgs = Object.entries(marks).map(([id, entry]) => ({
  id,
  render: entry.render,
  text: readFileSync(resolve(markFolder, `${id}.svg`), "utf8"),
}));

const logos: (Logo & { render: MarkRender })[] = markSvgs.map(({ id, render, text }) => ({
  key: id,
  render,
  paints: svgPaints(text),
}));

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
  it("reads on both themes as its render says, on a plate only where it would disappear", () => {
    const problems: string[] = [];
    for (const logo of logos) {
      if (logo.render === "theme") continue;
      const fit = { dark: themeFit(logo, DARK), light: themeFit(logo, LIGHT) };
      if (logo.render === "color") {
        for (const theme of ["dark", "light"] as const)
          if (fit[theme] === "gone")
            problems.push(`${logo.key}: disappears on the ${theme} theme; use the brand's variant`);
        continue;
      }
      const plate = logo.render === "plate-dark" ? "dark" : "light";
      const bare = plate === "dark" ? "light" : "dark";
      if (fit[bare] === "gone")
        problems.push(`${logo.key}: disappears on the ${bare} theme, where it has no plate`);
      if (fit[plate] === "fine")
        problems.push(`${logo.key}: on a ${plate} plate it doesn't need; render it as color`);
    }
    expect(problems).toEqual([]);
  });

  it("never follows the system's theme in place of the app's", () => {
    const following = markSvgs
      .filter(({ render, text }) => render !== "theme" && /@media/.test(text))
      .map(({ id }) => id);
    expect(following).toEqual([]);
  });

  it("gives every engine Misty can run its own mark", () => {
    const native = [
      ...readFileSync(resolve(repositoryRoot, "src-tauri/features/engines/mod.rs"), "utf8")
        .split("pub fn engine_by_id")[1]
        .split("\n}\n")[0]
        .matchAll(/"([a-z0-9-]+)" =>/g),
    ].map((match) => match[1]);
    const engines = new Set([...ENGINE_IDS, ...native]);
    const missing = [...engines].filter((id) => !hasMark(`engine:${id}`));
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
    const presets = Object.values(PRESETS).flatMap((list) => list ?? []);
    const unknown = [...providers, ...presets]
      .map((item) => item.mark)
      .filter((mark): mark is string => Boolean(mark) && !markFor(mark));
    expect(unknown).toEqual([]);
  });

  it("never renders a blank logo", () => {
    const shown = (element: ReactElement) => {
      const { container } = render(element);
      const filled = Boolean(container.firstElementChild);
      cleanup();
      return filled;
    };
    expect(shown(<Mark of="no-such-brand" />)).toBe(true);
    expect(shown(<Mark of="engine:no-such-engine" />)).toBe(true);
    expect(shown(<Mark of="misty" />)).toBe(true);
    expect(shown(<Mark of="engine:misty" />)).toBe(true);
    expect(shown(<Mark of={null} />)).toBe(true);
  });
});
