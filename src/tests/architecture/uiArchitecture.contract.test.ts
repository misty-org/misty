import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { repositoryPath, sourcePath, walk } from "./repositoryPolicy";
import {
  isUiRuleSubject,
  uiExceptionsBaselinePath,
  uiRules,
  uiViolations,
  type UiRuleId,
} from "./uiRules";

const extensions = new Set([".ts", ".tsx"]);
const uiImplementationRoots = ["src/shared/ui/"];
/** Files whose job is defining custom properties that stylesheets read. */
const customPropertyDefinitionOwners = new Set([
  // Runtime geometry and user-selected group colors feed the shell stylesheets.
  "src/app/layouts/DesktopLayout/dockingGeometry.ts",
  "src/app/layouts/DesktopLayout/MistyTabGroups.tsx",
  // The theme store writes the palette every surface reads.
  "src/features/settings/store/appTheme.ts",
  // The companion's runtime size feeds four rules in cursorCompanion.css.
  "src/features/agents/companion/CursorCompanionRoot.tsx",
]);
/** The cursor companion rides the pointer and rotates every frame; it is never pixel-aligned. */
const pointerFollowingFiles = new Set([
  "src/features/agents/companion/CursorCompanionRoot.tsx",
  "src/features/agents/companion/cursorCompanion.css",
]);
const allowedSourceRoots = new Set([
  "api",
  "app",
  "features",
  "native",
  "shared",
  "styles",
  "telemetry",
  "tests",
]);

describe("UI architecture contract", () => {
  it("keeps behavior tests colocated with their source", () => {
    const failures = walk("src", extensions)
      .map(repositoryPath)
      .filter((path) => path.includes("/__tests__/"));
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("keeps the frontend inside the documented top-level layers", () => {
    const failures = walk("src", extensions)
      .map(repositoryPath)
      .filter((path) => path !== "src/vite-env.d.ts")
      .map((path) => path.split("/")[1])
      .filter((root) => root && !allowedSourceRoots.has(root));
    expect([...new Set(failures)], failures.join("\n")).toEqual([]);
  });

  it("imports shared UI only through its barrel", () => {
    const failures = walk("src", extensions)
      .map(repositoryPath)
      .filter((path) => !uiImplementationRoots.some((root) => path.startsWith(root)))
      .filter((path) =>
        /from\s+["'](?:@\/shared\/ui\/|(?:\.\.?\/)+(?:[\w-]+\/)*shared\/ui\/)/.test(
          readFileSync(path, "utf8"),
        ),
      )
      .map((path) => `${path}: import from "@/shared/ui"`);
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("names component files in PascalCase", () => {
    const failures = walk("src", new Set([".tsx"]))
      .map(repositoryPath)
      .filter((path) => !/\.test\.tsx$/.test(path))
      // AGENTS.md requires this single navigation registry at its stable path.
      .filter((path) => path !== "src/features/settings/settingsRegistry.tsx")
      .filter((path) => {
        const name = path
          .split("/")
          .pop()!
          .replace(/\.tsx$/, "");
        return !/^[A-Z]/.test(name) && !/^[a-z]+$/.test(name) && !/^use[A-Z]/.test(name);
      });
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("keeps shared primitives at the UI boundary", () => {
    const failures: string[] = [];
    for (const path of walk("src", extensions)) {
      const relative = repositoryPath(path);
      if (relative.endsWith(".test.ts") || relative.endsWith(".test.tsx")) continue;
      const text = readFileSync(path, "utf8");
      if (
        !uiImplementationRoots.some((root) => relative.startsWith(root)) &&
        /from\s+["'](?:@radix-ui\/|radix-ui["'])/.test(text)
      ) {
        failures.push(`${relative}: import Radix only inside src/shared/ui`);
      }
      // Reading a token with var() inside a Tailwind class is fine; defining new custom
      // properties inline is where styling escapes the design system.
      if (
        !uiImplementationRoots.some((root) => relative.startsWith(root)) &&
        !customPropertyDefinitionOwners.has(relative) &&
        /["']--[a-z][a-z0-9-]*["']\s*:/.test(text)
      ) {
        failures.push(`${relative}: use Tailwind classes instead of CSS custom properties`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  // A -50% translate lands odd-sized surfaces on a half pixel, which blurs their text on 1x
  // displays. Center with layout instead (inset-0 m-auto, inset-x-0 mx-auto w-fit), which snaps.
  // Shared UI is included: dialogs are where this showed up first.
  it("centers surfaces with layout, not half-size translates", () => {
    const failures: string[] = [];
    for (const path of walk("src", new Set([...extensions, ".css"]))) {
      const relative = repositoryPath(path);
      if (/\.test\.tsx?$/.test(relative) || pointerFollowingFiles.has(relative)) continue;
      if (/translate-[xy]-1\/2|translate[XY]?\(\s*-?50%/.test(readFileSync(path, "utf8"))) {
        failures.push(`${relative}: center with inset + auto margins instead of translate 50%`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("composes shared UI everywhere, with a baseline that only shrinks", () => {
    const baseline: Record<string, UiRuleId[]> = JSON.parse(
      readFileSync(sourcePath(uiExceptionsBaselinePath), "utf8"),
    );
    const failures: string[] = [];
    const seen = new Set<string>();
    for (const path of walk("src", extensions).map(repositoryPath).filter(isUiRuleSubject)) {
      seen.add(path);
      const allowed = new Set(baseline[path] ?? []);
      const found = uiViolations(path, readFileSync(sourcePath(path), "utf8"));
      for (const id of found) {
        if (!allowed.has(id)) failures.push(`${path}: ${uiRules[id].guidance} [${id}]`);
      }
      for (const id of allowed) {
        if (!found.includes(id)) failures.push(`${path}: fixed ${id}; remove it from the baseline`);
      }
    }
    for (const path of Object.keys(baseline)) {
      if (!seen.has(path)) failures.push(`${path}: gone; remove it from the baseline`);
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
