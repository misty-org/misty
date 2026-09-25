import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { prepareDevelopmentBundle } from "./dev-app-bundle.ts";

test(
  "profile app bundles preserve metadata and isolate executable copies across reloads",
  {
    skip: process.platform !== "darwin",
  },
  () => {
    const root = mkdtempSync(join(tmpdir(), "misty dev bundle "));
    try {
      const binary = join(root, "misty-desktop");
      writeFileSync(binary, "first build", { mode: 0o755 });
      const first = prepareDevelopmentBundle(binary, "device-1");
      const second = prepareDevelopmentBundle(binary, "device-2");
      assert.notEqual(first.bundle, second.bundle);
      assert.notEqual(statSync(first.executable).ino, statSync(binary).ino);
      const info = JSON.parse(
        execFileSync(
          "/usr/bin/plutil",
          ["-convert", "json", "-o", "-", join(first.bundle, "Contents/Info.plist")],
          { encoding: "utf8" },
        ),
      );
      assert.equal(info.CFBundleName, "device-1");
      assert.equal(info.CFBundleDisplayName, "device-1");
      assert.equal(info.CFBundleIdentifier, "com.misty.desktop.device-1");
      assert.equal(info.CFBundleExecutable, "misty-desktop");
      assert.ok(info.NSMicrophoneUsageDescription);
      assert.ok(info.NSCameraUsageDescription);
      assert.ok(statSync(join(first.bundle, "Contents/Resources/icon.icns")).size > 0);
      writeFileSync(binary, "second build");
      assert.deepEqual(prepareDevelopmentBundle(binary, "device-1"), first);
      assert.equal(readFileSync(first.executable, "utf8"), "second build");
      assert.equal(readFileSync(second.executable, "utf8"), "first build");
      const normal = prepareDevelopmentBundle(binary);
      assert.equal(normal.bundle, join(root, "misty-dev-apps/Misty.app"));
      assert.throws(() => prepareDevelopmentBundle(binary, "../outside"));
      assert.throws(() => prepareDevelopmentBundle(binary, ""));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
