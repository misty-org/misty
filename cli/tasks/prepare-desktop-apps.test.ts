import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { createDesktopAppPreparation, prepareDesktopApps } from "./prepare-desktop-apps.ts";
import { localAppsDirectory } from "./local-apps-directory.ts";

test("prefers this checkout and supports explicit standalone fixture paths", () => {
  const root = mkdtempSync(resolve(tmpdir(), "misty-app-directory-"));
  try {
    assert.equal(localAppsDirectory(undefined, root, root), "");
    assert.throws(() => localAppsDirectory("missing", root, root), /catalog not found/);
    const custom = resolve(root, "custom");
    mkdirSync(custom); writeFileSync(resolve(custom, "catalog.json"), "{}");
    assert.equal(localAppsDirectory("~/custom", root, root), custom);
    const apps = resolve(root, "apps");
    mkdirSync(apps); writeFileSync(resolve(apps, "catalog.json"), "{}");
    assert.equal(localAppsDirectory(undefined, root, root), apps);
    assert.equal(localAppsDirectory(custom, root, root), custom);
    assert.equal(localAppsDirectory("~/misty-org/misty-apps", root, root), apps);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function localAppFixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), "misty-app-on-demand-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const apps = resolve(root, "apps-repo");
  mkdirSync(resolve(apps, "apps"), { recursive: true });
  writeFileSync(resolve(apps, "catalog.json"), JSON.stringify({ apps: [
    { id: "planner", desktop: { runtime: "downloaded" } },
    { id: "browser", desktop: { runtime: "downloaded" } },
    { id: "agents", desktop: { runtime: "downloaded" } },
    { id: "chat", desktop: { runtime: "embedded" } },
  ] }));
  return {
    root,
    apps,
    env: { VITE_MISTY_APPS_DIRECTORY: apps },
    publish(appId) {
      const output = resolve(apps, ".build/official-apps", appId, "desktop");
      mkdirSync(output, { recursive: true });
      for (const file of ["app.js", "app.css"]) writeFileSync(resolve(output, file), "fixture");
    },
  };
}

test("starts idle, builds only requested apps, and shares concurrent asset requests", async (t) => {
  const fixture = localAppFixture(t);
  const calls = [];
  let finish;
  const ensure = createDesktopAppPreparation(fixture.root, fixture.env, async (_executable, args) => {
    calls.push(args.slice(1));
    await new Promise((resolveRun) => { finish = resolveRun; });
    fixture.publish(args[1]);
  });
  assert.equal(calls.length, 0, "Creating the dev server must not build packages");
  const javascript = ensure("planner");
  const stylesheet = ensure("planner");
  assert.equal(javascript, stylesheet);
  await new Promise(setImmediate);
  assert.deepEqual(calls, [["planner", "--desktop-only"]]);
  finish();
  assert.deepEqual(await Promise.all([javascript, stylesheet]), [true, true]);
  assert.equal(await ensure("planner"), true);
  assert.equal(calls.length, 1, "Fresh assets should be reused");
  for (const appId of ["../planner", "unknown", "agents", "chat"])
    assert.equal(await ensure(appId), false);
  assert.equal(calls.length, 1, "Only catalogued downloaded personal apps can build");
});

test("serializes builds and permits retries after failure", async (t) => {
  const fixture = localAppFixture(t);
  let failFirst;
  const calls = [];
  const ensure = createDesktopAppPreparation(fixture.root, fixture.env, async (_executable, args) => {
    calls.push(args[1]);
    if (calls.length === 1) await new Promise((_resolve, reject) => { failFirst = reject; });
    fixture.publish(args[1]);
  });
  const failed = assert.rejects(ensure("planner"), /fixture build failed/);
  const browser = ensure("browser");
  await new Promise(setImmediate);
  assert.deepEqual(calls, ["planner"]);
  failFirst(new Error("fixture build failed"));
  await failed;
  assert.equal(await browser, true);
  assert.equal(await ensure("planner"), true);
  assert.deepEqual(calls, ["planner", "browser", "planner"]);
});

test("rechecks source freshness on later requests", async (t) => {
  const fixture = localAppFixture(t);
  const calls = [];
  const ensure = createDesktopAppPreparation(fixture.root, fixture.env, async (_executable, args) => {
    calls.push(args[1]);
    fixture.publish(args[1]);
  });
  await ensure("planner");
  const source = resolve(fixture.apps, "planner/index.tsx");
  mkdirSync(resolve(fixture.apps, "planner"), { recursive: true });
  writeFileSync(source, "changed source");
  const future = new Date(Date.now() + 2000);
  utimesSync(source, future, future);
  await ensure("planner");
  assert.deepEqual(calls, ["planner", "planner"]);
});

test("builds missing components directly without signing or packaging", () => {
  const root = mkdtempSync(resolve(tmpdir(), "misty-app-preflight-"));
  try {
    const apps = resolve(root, "apps-repo");
    mkdirSync(resolve(apps, "apps"), { recursive: true });
    writeFileSync(resolve(apps, "catalog.json"), JSON.stringify({ apps: [
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
    const source = resolve(apps, "planner/index.tsx");
    mkdirSync(resolve(apps, "planner"), { recursive: true });
    writeFileSync(source, "changed source");
    const future = new Date(Date.now() + 2000);
    utimesSync(source, future, future);
    let rebuilt = false;
    prepareDesktopApps(root, env, () => { rebuilt = true; });
    assert.equal(rebuilt, true, "Existing bundles must rebuild after source changes");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
