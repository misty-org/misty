import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { repositoryPath, repositoryRoot, walk } from "./repositoryPolicy";

type BaselineEntry = { length: number; hash: string };
const maxLength = 160;
const extensions = new Set([".ts", ".tsx", ".css"]);
const baseline = JSON.parse(
  readFileSync(
    resolve(repositoryRoot, "src/tests/contracts/fixtures/readability-baseline.json"),
    "utf8",
  ),
) as Record<string, BaselineEntry[]>;

function key(line: string): string {
  const hash = createHash("sha256").update(line).digest("hex").slice(0, 16);
  return `${line.length}:${hash}`;
}

describe("frontend readability contract", () => {
  it("rejects new long lines and stale exceptions", () => {
    const observed = new Map<string, Set<string>>();
    const failures: string[] = [];
    for (const path of walk("src", extensions)) {
      const relative = repositoryPath(path);
      readFileSync(path, "utf8")
        .split(/\r?\n/)
        .forEach((line, index) => {
          const trimmed = line.trim();
          if (
            line.length <= maxLength ||
            trimmed.startsWith("data:") ||
            trimmed.startsWith("//") ||
            trimmed.includes("http://") ||
            trimmed.includes("https://")
          ) {
            return;
          }
          const lineKey = key(line);
          const known = (baseline[relative] ?? []).some(
            (entry) => `${entry.length}:${entry.hash}` === lineKey,
          );
          if (!known) failures.push(`${relative}:${index + 1}: ${line.length} characters`);
          const entries = observed.get(relative) ?? new Set<string>();
          entries.add(lineKey);
          observed.set(relative, entries);
        });
    }
    for (const [path, entries] of Object.entries(baseline)) {
      for (const entry of entries) {
        if (!observed.get(path)?.has(`${entry.length}:${entry.hash}`)) {
          failures.push(`${path}: stale readability baseline ${entry.hash}`);
        }
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
