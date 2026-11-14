import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { controlFrame } from "@/shared/ui";
import { repositoryPath, walk } from "./repositoryPolicy";

/**
 * Every shared control takes its height and corners from controlFrame.ts, so a search box, a
 * select, a chip and a button of one size line up and round alike. A control that writes its own
 * `h-8` with its own `rounded-md` beside it drifts from the rest (the 36px search beside 32px
 * selects, the 7px select beside 9px fields), so a string that pairs a control height with a
 * corner fails here. Features are held to the same frame by the field-restyle and button-restyle
 * UI rules.
 */

const controlFiles = [
  ...walk("src/shared/ui/controls", new Set([".ts", ".tsx"])),
  // The placeholders that stand in for controls while a list loads.
  ...walk("src/shared/ui/feedback", new Set([".tsx"])).filter((path) =>
    path.endsWith("Skeleton.tsx"),
  ),
].filter((path) => !path.endsWith("controlFrame.ts") && !/\.test\.tsx?$/.test(path));

const literal = /"[^"\n]*"|'[^'\n]*'|`[^`]*`/g;
const height = /(?<![\w[-])(?:h|size)-(?:6|8|9)(?![\w.-])/;
const corner = /(?<![\w[-])rounded-(?:sm|md|lg|xl)(?![\w-])/;

describe("control frames", () => {
  it("gives every size one height and one corner, with fields and buttons alike", () => {
    expect(controlFrame.md).toMatch(/\bh-8\b/);
    expect(controlFrame.lg).toMatch(/\bh-9\b/);
    // A 32px field and a 32px button round the same.
    expect(controlFrame.md.match(corner)?.[0]).toBe(controlFrame.lg.match(corner)?.[0]);
  });

  it("keeps shared controls from pairing a height with corners of their own", () => {
    const failures: string[] = [];
    for (const path of controlFiles) {
      const text = readFileSync(path, "utf8");
      for (const match of text.matchAll(literal)) {
        const value = match[0];
        if (height.test(value) && corner.test(value)) {
          const line = text.slice(0, match.index).split("\n").length;
          failures.push(`${repositoryPath(path)}:${line}: ${value} (use controlFrame)`);
        }
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
