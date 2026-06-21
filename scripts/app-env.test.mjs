import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { loadAppEnv, publicAppEnv } from "./app-env.mjs";

test("reads only .env and keeps shell overrides without exposing private keys", () => {
  const root = mkdtempSync(resolve(tmpdir(), "misty-env-"));
  try {
    writeFileSync(resolve(root, ".env"), 'VITE_LABEL="App label"\nPRIVATE_KEY=private-fixture\nVITE_OVERRIDE=file\n');
    for (const name of [".env.local", ".env.desktop", ".env.desktop.local", ".env.analytics", ".env.production"])
      writeFileSync(resolve(root, name), "VITE_LABEL=wrong\nVITE_MODE_ONLY=wrong\n");
    const env = loadAppEnv(root, { VITE_OVERRIDE: "shell" });
    assert.deepEqual(env, { VITE_LABEL: "App label", PRIVATE_KEY: "private-fixture", VITE_OVERRIDE: "shell" });
    assert.deepEqual(publicAppEnv(env), { "import.meta.env.VITE_LABEL": '"App label"', "import.meta.env.VITE_OVERRIDE": '"shell"' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("works without .env for CI-only configuration", () => {
  const root = mkdtempSync(resolve(tmpdir(), "misty-env-"));
  try { assert.deepEqual(loadAppEnv(root, { VITE_LABEL: "CI" }), { VITE_LABEL: "CI" }); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
