import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { repositoryRoot, sourcePath } from "./repositoryPolicy";

// Misty carries a copy of misty-catalog's pins with its release (`npm run sync:catalog`): the apps, the speech models
// and voices, and the engines. Where a misty-catalog checkout (or misty-apps, until it is renamed) sits beside this
// one, each copy must say what it says, so a pin reviewed there never stays behind here.
function siblingCatalog(): string | undefined {
  // A linked worktree sits inside the checkout, so look up from it for the sibling.
  for (let folder = dirname(repositoryRoot); ; folder = dirname(folder)) {
    for (const name of ["misty-catalog", "misty-apps"]) {
      const candidate = join(folder, name);
      if (existsSync(join(candidate, "catalog.json"))) return candidate;
    }
    if (dirname(folder) === folder) return undefined;
  }
}

const upstream = siblingCatalog();
const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

const copies: [string, string][] = [
  ["catalog.json", "src/features/spaces/apps/catalog.json"],
  ["speech.json", "src-tauri/features/voice/speech_catalog.json"],
  ["engines.json", "src/features/agents/marketplace/engines.json"],
];

describe("catalog contract", () => {
  for (const [name, copy] of copies)
    it.skipIf(!upstream || !existsSync(join(upstream ?? "", name)))(
      `matches misty-catalog's ${name}`,
      () => {
        expect(
          read(sourcePath(copy)),
          `${copy} is behind misty-catalog: run \`npm run sync:catalog\`.`,
        ).toEqual(read(join(upstream!, name)));
      },
    );
});
