import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { optimizeDeps, resolveConfig } from "vite";
import { execFileSync } from "node:child_process";

test("simultaneous desktop profiles do not rewrite each other's dependency cache", () => {
  const configFile = join(import.meta.dirname, "../../.config/vite.config.ts");
  const script = `
    import { resolveConfig } from "vite";
    const config = await resolveConfig({ configFile: ${JSON.stringify(configFile)}, mode: "desktop", logLevel: "silent" }, "serve");
    console.log(JSON.stringify({ cache: config.cacheDir, port: config.server.port }));
  `;
  const configuration = (profile, port) => JSON.parse(execFileSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    { encoding: "utf8", env: { ...process.env, MISTY_DESKTOP_PROFILE: profile, MISTY_DESKTOP_DEV_PORT: String(port) } },
  ));
  const first = configuration("dev1", 5173);
  const second = configuration("dev2", 5174);
  assert.equal(first.port, 5173);
  assert.equal(second.port, 5174);
  assert.notEqual(first.cache, second.cache);
  assert.deepEqual(configuration("dev1", 5173), first);
});

test("the app dependency scan succeeds before Explorer is opened", { timeout: 60000 }, async () => {
  // Use the shipping config and graph, with a cold private cache. Standalone
  // probe HTML must not poison this scan or alter a running developer's cache.
  const cacheDir = await mkdtemp(join(tmpdir(), "misty-app-entry-test-"));
  try {
    const config = await resolveConfig({ configFile: join(import.meta.dirname, "../../.config/vite.config.ts"), cacheDir, mode: "desktop", logLevel: "error" }, "serve");
    const metadata = await optimizeDeps(config, true, true);
    for (const dependency of [
      "react",
      "react-dom/client",
      "@crabnebula/tauri-plugin-drag",
    ]) {
      assert.ok(metadata.optimized[dependency], `${dependency} must be ready before navigation`);
    }
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});
