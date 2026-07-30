import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { lineCount, repositoryPath, repositoryRoot, walk } from "./repositoryPolicy";

const defaultLimit = 500;
const extensions = new Set([".js", ".jsx", ".rs", ".sh", ".ts", ".tsx"]);
const baseline = JSON.parse(
  readFileSync(
    resolve(repositoryRoot, "src/tests/contracts/fixtures/file-size-baseline.json"),
    "utf8",
  ),
) as Record<string, number>;

describe("source-size architecture contract", () => {
  const measured = new Map(
    ["src", "src-tauri/src"]
      .flatMap((root) => walk(root, extensions))
      .map((path) => [repositoryPath(path), lineCount(path)]),
  );

  it("does not introduce or grow handwritten files above 500 lines", () => {
    const failures: string[] = [];
    for (const [path, lines] of measured) {
      const ceiling = baseline[path];
      if (lines <= defaultLimit && ceiling !== undefined) {
        failures.push(`${path}: remove stale ${ceiling}-line baseline`);
      } else if (lines > defaultLimit && ceiling === undefined) {
        failures.push(`${path}: ${lines} lines exceeds ${defaultLimit} without a baseline`);
      } else if (ceiling !== undefined && lines > ceiling) {
        failures.push(`${path}: grew to ${lines} lines (baseline ${ceiling})`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("contains only valid baseline entries", () => {
    const failures = Object.entries(baseline)
      .filter(
        ([path, ceiling]) =>
          !Number.isInteger(ceiling) || ceiling <= defaultLimit || !measured.has(path),
      )
      .map(([path]) => path);
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
