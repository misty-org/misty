import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { appSourceAliases, appSourceRoot } from "./app-source-paths.mjs";

test("all migrated component aliases point at app-owned source and match TypeScript", () => {
  const host = resolve(import.meta.dirname, "..");
  const apps = appSourceRoot(host);
  const paths = JSON.parse(readFileSync(resolve(host, "tsconfig.json"), "utf8")).compilerOptions.paths;
  const aliases = appSourceAliases(host, apps);
  for (const id of ["journal", "planner", "library", "agents", "files", "browser", "code", "terminal"]) {
    const name = `@/features/apps/package/SDK${id[0].toUpperCase() + id.slice(1)}App`;
    const target = resolve(apps, "apps", id, "index");
    assert.equal(aliases[name], target);
    assert.ok(existsSync(`${target}.tsx`));
    assert.equal(resolve(host, paths[name][0]), target);
  }
});
