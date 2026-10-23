import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { repositoryPath, walk } from "./repositoryPolicy";

/**
 * Every Misty window belongs to a Space, and only `infra/space_windows` names window
 * labels. A leftover `"main"` would aim an event or a trust check at a window that no
 * longer exists, and fail silently.
 */
const helper = /^src-tauri\/src\/infra\/space_windows(\.rs|\/)/;
// Git's default branch in repository fixtures, not a window.
const gitBranchFixtures = new Set([
  "src-tauri/src/agents/project_git.rs",
  "src-tauri/src/agents/checkpoints/tests.rs",
]);

describe("Space window labels contract", () => {
  it('names no window "main" outside the Space windows helper', () => {
    const failures = walk("src-tauri/src", new Set([".rs"]))
      .map((path) => [repositoryPath(path), readFileSync(path, "utf8")] as const)
      .filter(([path]) => !helper.test(path) && !gitBranchFixtures.has(path))
      .flatMap(([path, text]) =>
        text
          .split("\n")
          .map((line, index) => [index + 1, line] as const)
          .filter(([, line]) => line.includes('"main"'))
          .map(([line]) => `${path}:${line}`),
      );
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("gives app windows window labels in the capabilities, never main", () => {
    const capability = JSON.parse(readFileSync("src-tauri/capabilities/default.json", "utf8")) as {
      webviews: string[];
    };
    expect(capability.webviews).toContain("window-*");
    expect(capability.webviews).toContain("incognito-*");
    expect(capability.webviews).not.toContain("main");
  });
});
