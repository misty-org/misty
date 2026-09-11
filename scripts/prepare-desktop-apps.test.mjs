import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { prepareDesktopApps } from "./prepare-desktop-apps.mjs";
import { localAppsDirectory } from "./local-apps-directory.mjs";

test("discovers repositories, expands home paths, and falls back when absent", () => {
  const root = mkdtempSync(resolve(tmpdir(), "misty-app-directory-"));
  try {
    assert.equal(localAppsDirectory(undefined, resolve(root, "host"), root), "");
    const apps = resolve(root, "misty-org/misty-apps");
    mkdirSync(resolve(apps, "apps"), { recursive: true });
    writeFileSync(resolve(apps, "apps/catalog.json"), "{}");
    assert.equal(localAppsDirectory(undefined, root, root), apps);
    assert.equal(localAppsDirectory("~/misty-org/misty-apps", root, root), apps);
    assert.throws(() => localAppsDirectory("missing", root, root), /catalog not found/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("builds missing components directly without signing or packaging", () => {
  const root = mkdtempSync(resolve(tmpdir(), "misty-app-preflight-"));
  try {
    const apps = resolve(root, "apps-repo");
    mkdirSync(resolve(apps, "apps"), { recursive: true });
    writeFileSync(resolve(apps, "apps/catalog.json"), JSON.stringify({ apps: [
      { id: "planner", desktop: { runtime: "downloaded" } },
      { id: "chat", desktop: { runtime: "embedded" } },
    ] }));
    const env = { VITE_MISTY_APPS_DIRECTORY: apps };
    const calls = [];
    prepareDesktopApps(root, env, (_executable, args) => {
      calls.push(args);
      const output = resolve(apps, ".build/official-apps/planner/desktop");
      mkdirSync(output, { recursive: true });
      for (const file of ["app.js", "app.css"]) writeFileSync(resolve(output, file), "fixture");
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(1), ["planner", "--desktop-only"]);
    prepareDesktopApps(root, env, () => assert.fail("Unchanged components need no build"));
    const source = resolve(apps, "apps/planner/index.tsx");
    mkdirSync(resolve(apps, "apps/planner"), { recursive: true });
    writeFileSync(source, "changed source");
    const future = new Date(Date.now() + 2000);
    utimesSync(source, future, future);
    let rebuilt = false;
    prepareDesktopApps(root, env, () => { rebuilt = true; });
    assert.equal(rebuilt, true, "Existing bundles must rebuild after source changes");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
