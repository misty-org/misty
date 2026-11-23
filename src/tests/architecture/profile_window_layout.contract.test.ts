import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { repositoryPath, walk } from "./repository_policy";

const scopeMap = new RegExp(
  `\\b(${[
    "layoutsByScope",
    "windowIdsByScope",
    "activeScopeKey",
    "WorkspaceScopeKey",
    "showSpaceScope",
    "switchWorkspaceScope",
    "spaceLayout",
    "windowSpaceScope",
    "mapAllWorkspaceWindowLayouts",
    "mapAllWorkspaceWindowViews",
  ].join("|")})\\b`,
);
const isTest = (path: string) =>
  /\.(test|contract\.test|testFixtures|test_fixtures)\.tsx?$/.test(path);
const sources = () =>
  walk("src", new Set([".ts", ".tsx"])).map(
    (path) => [repositoryPath(path), readFileSync(path, "utf8")] as const,
  );

describe("one layout per window", () => {
  it("keeps no layout per Space", () => {
    const failures = sources()
      .filter(([path]) => !isTest(path))
      .flatMap(([path, text]) =>
        text
          .split("\n")
          .map((line, index) => [index + 1, line] as const)
          .filter(([, line]) => scopeMap.test(line))
          .map(([line]) => `${path}:${line}`),
      );
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("takes the window's profile from the native window", () => {
    const window = readFileSync("src/features/app-windows/profiles/profile_window.ts", "utf8");
    expect(window).toContain("__MISTY_WINDOW__");
    expect(window).toContain('"profile_window_info"');
    const space = readFileSync("src/features/app-windows/tabs/space_window.ts", "utf8");
    expect(space).not.toContain("useWorkspaceStore");
    expect(space).toContain('"profile_window_set_space"');
  });

  it("never lets switching Space touch tabs", () => {
    const bridge = readFileSync("src/features/spaces/SpaceWindowBridge.tsx", "utf8");
    expect(bridge).not.toContain("useWorkspaceStore");
    expect(bridge).not.toContain("onSpaceWindowSwitch");
  });
});
