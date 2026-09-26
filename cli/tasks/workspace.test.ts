import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "../..");
const json = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8"));

test("built-in tools share the host runtime without public app packages", () => {
  const host = json("package.json");
  assert.equal(existsSync(resolve(root, "apps/package.json")), false);
  for (const retired of [
    "packages/sdk/package.json",
    "packages/contracts/package.json",
    "examples/habit-tracker/package.json",
    "src-tauri/src/platform/mini_app_bridge.js",
  ]) assert.equal(existsSync(resolve(root, retired)), false, retired);
  assert.equal(host.workspaces, undefined);
  assert.equal(host.dependencies["@misty/sdk"], undefined);
  assert.equal(host.dependencies["@misty/contracts"], undefined);
  for (const name of ["react", "react-dom"]) {
    assert.match(host.dependencies[name], /^19\./);
    const hostRequire = createRequire(resolve(root, "package.json"));
    const appRequire = createRequire(resolve(root, "src/app/hostMain.tsx"));
    assert.equal(hostRequire.resolve(name), appRequire.resolve(name));
  }
});

test("owned tooling is TypeScript and the checkout has no app submodule", () => {
  const modules = existsSync(resolve(root, ".gitmodules"))
    ? readFileSync(resolve(root, ".gitmodules"), "utf8") : "";
  assert.doesNotMatch(modules, /path\s*=\s*apps(?:\/|\s|$)/m);
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
