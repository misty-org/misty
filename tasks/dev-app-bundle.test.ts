import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { prepareDevelopmentBundle } from "./dev-app-bundle.ts";

test(
  "the dev app bundle keeps its metadata and its own executable copy across reloads",
  {
    skip: process.platform !== "darwin",
  },
  () => {
    const root = mkdtempSync(join(tmpdir(), "misty dev bundle "));
    try {
      const binary = join(root, "misty-desktop");
      writeFileSync(binary, "first build", { mode: 0o755 });
      const app = prepareDevelopmentBundle(binary);
      assert.equal(app.bundle, join(root, "misty-dev-apps/Misty.app"));
      assert.notEqual(statSync(app.executable).ino, statSync(binary).ino);
      const info = JSON.parse(
        execFileSync(
          "/usr/bin/plutil",
          ["-convert", "json", "-o", "-", join(app.bundle, "Contents/Info.plist")],
          { encoding: "utf8" },
        ),
      );
      assert.equal(info.CFBundleName, "Misty");
      assert.equal(info.CFBundleDisplayName, "Misty");
      assert.equal(info.CFBundleIdentifier, "com.misty.desktop");
      assert.equal(info.CFBundleExecutable, "misty-desktop");
      assert.ok(info.NSMicrophoneUsageDescription);
      assert.ok(info.NSCameraUsageDescription);
      assert.ok(statSync(join(app.bundle, "Contents/Resources/icon.icns")).size > 0);
      writeFileSync(binary, "second build");
      assert.deepEqual(prepareDevelopmentBundle(binary), app);
      assert.equal(readFileSync(app.executable, "utf8"), "second build");
      // A partial copy left by an interrupted run must not reach codesign.
      const stale = `${app.executable}.99999.tmp`;
      writeFileSync(stale, "partial");
      prepareDevelopmentBundle(binary);
      assert.deepEqual(readdirSync(join(app.bundle, "Contents/MacOS")), ["misty-desktop"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
