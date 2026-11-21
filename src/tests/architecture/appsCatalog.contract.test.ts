import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { repositoryRoot, sourcePath } from "./repositoryPolicy";

// Misty carries a copy of misty-apps' catalog with its release (`npm run sync:apps`). Where a misty-apps checkout
// sits beside this one, the copy must say what it says, so a pin reviewed there never stays behind here.
function siblingCatalog(): string | undefined {
  // A linked worktree sits inside the checkout, so look up from it for the sibling.
  for (let folder = dirname(repositoryRoot); ; folder = dirname(folder)) {
    const candidate = join(folder, "misty-apps", "catalog.json");
    if (existsSync(candidate)) return candidate;
    if (dirname(folder) === folder) return undefined;
  }
}

const upstream = siblingCatalog();
const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

describe("apps catalog contract", () => {
  it.skipIf(!upstream)("matches misty-apps' catalog", () => {
    const copy = read(sourcePath("src/features/spaces/apps/catalog.json"));
    expect(copy, "The apps catalog is behind misty-apps: run `npm run sync:apps`.").toEqual(read(upstream!));
  });
});
