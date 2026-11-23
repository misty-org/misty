import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { lineCount, repositoryPath, repositoryRoot, walk, walkAppCrate } from "./repository_policy";

const componentLimit = 500;
const defaultLimit = 1000;
const limitFor = (path: string) => (path.endsWith(".tsx") ? componentLimit : defaultLimit);
const extensions = new Set([".js", ".jsx", ".rs", ".sh", ".ts", ".tsx"]);
const baseline = JSON.parse(
  readFileSync(
    resolve(repositoryRoot, "src/tests/architecture/fixtures/file-size-baseline.json"),
    "utf8",
  ),
) as Record<string, number>;

describe("source-size architecture contract", () => {
  const measured = new Map(
    [...walk("src", extensions), ...walkAppCrate("src-tauri/features", extensions)].map((path) => [
      repositoryPath(path),
      lineCount(path),
    ]),
  );

  it("does not introduce or grow components above 500 lines or other files above 1000", () => {
    const failures: string[] = [];
    for (const [path, lines] of measured) {
      const ceiling = baseline[path];
      const limit = limitFor(path);
      if (lines <= limit && ceiling !== undefined) {
        failures.push(`${path}: remove stale ${ceiling}-line baseline`);
      } else if (lines > limit && ceiling === undefined) {
        failures.push(`${path}: ${lines} lines exceeds ${limit} without a baseline`);
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
          !Number.isInteger(ceiling) || ceiling <= limitFor(path) || !measured.has(path),
      )
      .map(([path]) => path);
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
