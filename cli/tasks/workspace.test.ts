import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "../..");
const json = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8"));

test("features share the host React runtime", () => {
  const host = json("package.json");
  for (const name of ["react", "react-dom"]) {
    assert.match(host.dependencies[name], /^19\./);
    const hostRequire = createRequire(resolve(root, "package.json"));
    const appRequire = createRequire(resolve(root, "src/app/HostMain.tsx"));
    assert.equal(hostRequire.resolve(name), appRequire.resolve(name));
  }
});

test("owned tooling is TypeScript", () => {
  const inspect = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (["node_modules", "target", "dist", ".build"].includes(entry.name) || entry.isSymbolicLink()) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) inspect(path);
      else assert.equal(entry.name.endsWith(".mjs"), false, path);
    }
  };
  for (const name of ["cli"]) inspect(resolve(root, name));
});
