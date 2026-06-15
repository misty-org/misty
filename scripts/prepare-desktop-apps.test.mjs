import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { missingDesktopPackages, prepareDesktopApps } from "./prepare-desktop-apps.mjs";

test("identifies missing/corrupt downloads while leaving embedded and current packages alone", () => {
  const root = mkdtempSync(resolve(tmpdir(), "misty-preflight-test-"));
  try {
    const bytes = Buffer.from("fixture archive");
    mkdirSync(resolve(root, "planner/1.1.0"), { recursive: true });
    writeFileSync(resolve(root, "planner/1.1.0/desktop.zip"), bytes);
    const app = { id: "planner", version: "1.1.0", desktop: { runtime: "downloaded", sha256: createHash("sha256").update(bytes).digest("hex") } };
    const catalog = { apps: [app, { id: "journal", desktop: { runtime: "embedded" } }, { id: "terminal", version: "1.1.0", desktop: { runtime: "downloaded" } }] };
    assert.deepEqual(missingDesktopPackages(catalog, root), ["terminal"]);
    writeFileSync(resolve(root, "planner/1.1.0/desktop.zip"), "changed");
    assert.deepEqual(missingDesktopPackages(catalog, root), ["planner", "terminal"]);
    assert.throws(() => missingDesktopPackages({ apps: [{ ...app, version: "../../other" }] }, root), /invalid package identity/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("builds and signs only missing local packages, then skips a verified warm start", () => {
  const root = mkdtempSync(resolve(tmpdir(), "misty-preflight-test-"));
  try {
    const host = resolve(root, "host"), apps = resolve(root, "misty-apps");
    mkdirSync(host); mkdirSync(resolve(apps, "apps"), { recursive: true });
    mkdirSync(resolve(apps, "scripts"));
    writeFileSync(resolve(apps, "scripts/build-official-apps.mjs"), "fixture");
    const catalogPath = resolve(apps, "apps/catalog.json");
    const catalog = { apps: [{ id: "planner", version: "1.1.0", desktop: { runtime: "downloaded" } }] };
    writeFileSync(catalogPath, JSON.stringify(catalog));
    const calls = [];
    const run = (_executable, args, options) => {
      calls.push({ args, options });
      if (calls.length === 2) {
        mkdirSync(resolve(apps, "public/official-apps/planner/1.1.0"), { recursive: true });
        writeFileSync(resolve(apps, "public/official-apps/planner/1.1.0/desktop.zip"), "signed fixture");
        catalog.apps[0].desktop.sha256 = createHash("sha256").update("signed fixture").digest("hex");
        writeFileSync(catalogPath, JSON.stringify(catalog));
      }
    };
    prepareDesktopApps(host, {}, run);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].args.slice(1), ["planner"]);
    assert.equal(calls[0].options.env.MISTY_APPS_ROOT, apps);
    prepareDesktopApps(host, {}, () => assert.fail("A warm start must not rebuild"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
