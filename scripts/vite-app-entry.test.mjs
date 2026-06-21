import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { optimizeDeps, resolveConfig } from "vite";

test("the app dependency scan succeeds before Explorer is opened", { timeout: 60000 }, async () => {
  // Use the shipping config and graph, with a cold private cache. Standalone
  // probe HTML must not poison this scan or alter a running developer's cache.
  const cacheDir = await mkdtemp(join(tmpdir(), "misty-app-entry-test-"));
  try {
    const config = await resolveConfig({ cacheDir, mode: "desktop", logLevel: "error" }, "serve");
    const metadata = await optimizeDeps(config, true, true);
    for (const dependency of [
      "@crabnebula/tauri-plugin-drag",
      "mammoth",
      "jszip",
      "@tauri-apps/plugin-clipboard-manager",
      "react-filerobot-image-editor",
      "qrcode.react",
    ]) {
      assert.ok(metadata.optimized[dependency], `${dependency} must be ready before navigation`);
    }
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});
