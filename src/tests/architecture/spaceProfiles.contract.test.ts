import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { repositoryPath, walk } from "./repositoryPolicy";

/**
 * A Space is the browser profile. Device-only browser profiles (`profile:<id>` workspace
 * scopes with their own store and menu) were folded into Spaces and must not come back.
 */
const scopePattern = /[`"']profile:|profile:\$\{/;
const retired = [
  "src/features/workspace/browserProfiles.ts",
  "src/app/layouts/DesktopLayout/BrowserProfileMenu.tsx",
  "src/features/webviews/browserProfileResolver.ts",
];

describe("Spaces are the only browser profiles", () => {
  it("has no profile: workspace scopes", () => {
    const failures = walk("src", new Set([".ts", ".tsx"]))
      .map((path) => [repositoryPath(path), readFileSync(path, "utf8")] as const)
      .filter(([path]) => !path.endsWith("spaceProfiles.contract.test.ts"))
      .flatMap(([path, text]) =>
        text
          .split("\n")
          .map((line, index) => [index + 1, line] as const)
          .filter(([, line]) => scopePattern.test(line))
          .map(([line]) => `${path}:${line}`),
      );
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("keeps the workspace scope key to Spaces", () => {
    const model = readFileSync("src/features/workspace/model.ts", "utf8");
    expect(model).toMatch(/export type WorkspaceScopeKey = `space:\$\{string\}`;/);
  });

  it("has no device profile menu, store or resolver", () => {
    expect(retired.filter((path) => existsSync(path))).toEqual([]);
    const native = walk("src-tauri/src", new Set([".rs"]))
      .map((path) => [repositoryPath(path), readFileSync(path, "utf8")] as const)
      .filter(([, text]) => /browser_device_profile_delete|is_account_browser_profile/.test(text))
      .map(([path]) => path);
    expect(native).toEqual([]);
  });
});
