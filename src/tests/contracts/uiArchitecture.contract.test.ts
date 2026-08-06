import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { repositoryPath, walk } from "./repositoryPolicy";

const extensions = new Set([".ts", ".tsx"]);
const uiImplementationRoots = ["src/ui/", "src/models/interfaces/ui/", "src/models/types/ui/"];
const protectedRoots = [
  "src/features/explorer/",
  "src/features/spaces/",
  "src/pages/Agents/",
  "src/pages/Files/",
  "src/pages/Providers/",
  "src/pages/Settings/",
  "src/pages/Spaces/",
  "src/pages/Studio/",
  "src/pages/Transfers/",
];

describe("UI architecture contract", () => {
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
        failures.push(`${relative}: import Radix only inside src/ui`);
      }
      if (/var\(--|["']--[a-z][a-z0-9-]*["']\s*:/.test(text)) {
        failures.push(`${relative}: use Tailwind classes instead of CSS custom properties`);
      }
      if (!protectedRoots.some((root) => relative.startsWith(root))) continue;
      const forbidden = [
        [/<(?:button|input|select|textarea)\b/g, "use a shared control"],
        [/\bfixed\s+inset-0\b/g, "use a shared overlay"],
        [/\bcreatePortal\s*\(/g, "let the overlay primitive own its portal"],
        [/\bz-\[\d{4,}\]/g, "use a named layer token"],
      ] as const;
      for (const [pattern, guidance] of forbidden) {
        if (pattern.test(text)) failures.push(`${relative}: ${guidance}`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
