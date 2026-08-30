import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { repositoryPath, walk } from "@/tests/contracts/repositoryPolicy";

describe("embodied Misty contract", () => {
  it("keeps duplicate page-level launchers out while allowing contextual selection actions", () => {
    const failures = walk("src", new Set([".ts", ".tsx"]))
      .map(repositoryPath)
      .filter((path) => path.startsWith("src/features/") && !path.includes("/ai-surface/"))
      .filter((path) => !path.endsWith(".test.ts") && !path.endsWith(".test.tsx"))
      .filter((path) => /AiSurfaceButton|AiTaskWorkspace/.test(readFileSync(path, "utf8")));
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
