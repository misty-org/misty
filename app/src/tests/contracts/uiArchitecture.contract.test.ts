import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { repositoryPath, walk } from "./repositoryPolicy";

const extensions = new Set([".ts", ".tsx"]);
const uiImplementationRoots = ["src/shared/ui/"];
const protectedRoots = [
  "src/features/file-explorer/",
  "src/features/file-preview/",
  "src/features/file-search/",
  "src/features/providers/",
  "src/features/settings/",
  "src/features/space-chat/",
  "src/features/space-connections/",
  "src/features/space-library/",
  "src/features/space-members/",
  "src/features/space-planner/",
  "src/features/space-roadmap/",
  "src/features/spaces/",
  "src/features/transfers/",
];

const allowedSourceRoots = new Set([
  "app",
  "features",
  "pages",
  "services",
  "shared",
  "styles",
  "tests",
]);

describe("UI architecture contract", () => {
  it("keeps the frontend inside the documented top-level layers", () => {
    const failures = walk("src", extensions)
      .map(repositoryPath)
      .filter((path) => path !== "src/vite-env.d.ts")
      .map((path) => path.split("/")[1])
      .filter((root) => root && !allowedSourceRoots.has(root));
    expect([...new Set(failures)], failures.join("\n")).toEqual([]);
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
