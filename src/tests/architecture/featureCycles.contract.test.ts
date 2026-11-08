import { readFileSync } from "node:fs";
import { dirname, posix } from "node:path";
import { describe, expect, it } from "vitest";

import { repositoryPath, walk } from "./repositoryPolicy";

const featureRoot = "src/features/";
const sourceFiles = walk("src/features", new Set([".ts", ".tsx"]))
  .map(repositoryPath)
  .filter((path) => !/\.(test|testFixtures|acceptance)\.|test-support/.test(path));

const specifier = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])((?:@\/|\.\.?\/)[^"']+)\1/g;

function featureOf(path: string): string | null {
  return path.startsWith(featureRoot) ? path.slice(featureRoot.length).split("/")[0] : null;
}

/** Where an import points, as a path under src/, without resolving the extension. */
function target(from: string, spec: string): string {
  return spec.startsWith("@/")
    ? `src/${spec.slice(2)}`
    : posix.normalize(posix.join(dirname(from), spec));
}

interface Edge {
  from: string;
  to: string;
  file: string;
  path: string;
}

const edges: Edge[] = sourceFiles.flatMap((file) => {
  const own = featureOf(file);
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(specifier)].flatMap((match) => {
    const path = target(file, match[2]);
    const other = featureOf(path);
    return own && other && other !== own ? [{ from: own, to: other, file, path }] : [];
  });
});

function cycles(): string[][] {
  const next = new Map<string, Set<string>>();
  for (const edge of edges) next.set(edge.from, (next.get(edge.from) ?? new Set()).add(edge.to));
  const found: string[][] = [];
  const state = new Map<string, "open" | "done">();
  const stack: string[] = [];
  const visit = (node: string) => {
    state.set(node, "open");
    stack.push(node);
    for (const neighbour of next.get(node) ?? []) {
      if (state.get(neighbour) === "open")
        found.push([...stack.slice(stack.indexOf(neighbour)), neighbour]);
      else if (!state.has(neighbour)) visit(neighbour);
    }
    stack.pop();
    state.set(node, "done");
  };
  for (const node of next.keys()) if (!state.has(node)) visit(node);
  return found;
}

describe("feature layering contract", () => {
  it("sees the imports between features", () => {
    expect(edges.length).toBeGreaterThan(100);
  });

  it("has no import cycle between features", () => {
    const found = cycles().map((cycle) => cycle.join(" -> "));
    expect(found, `Features may not import each other in a loop:\n${found.join("\n")}`).toEqual([]);
  });

  it("reaches another feature only through its index or a file at its root", () => {
    const failures = edges
      .filter(({ path }) => path.slice(featureRoot.length).split("/").length > 2)
      .filter(({ path }) => !/^src\/features\/[^/]+\/index$/.test(path))
      .filter(({ file }) => !/\.css$/.test(file))
      // A lazy import() is how a feature loads a screen of another when it is needed.
      .filter(({ file, path }) => !isLazy(file, path))
      .map(({ file, path }) => `${file} -> ${path}`);
    expect(failures, failures.join("\n")).toEqual([]);
  });
});

function isLazy(file: string, path: string): boolean {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(specifier)].some(
    (match) =>
      target(file, match[2]) === path &&
      /import\s*\(\s*$/.test(
        text.slice(0, match.index! + match[0].length).replace(/["'][^"']*["']$/, ""),
      ),
  );
}
