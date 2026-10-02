import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const hook = resolve(root, ".githooks/checks.sh");
function plan(paths: string[]) {
  return execFileSync("bash", [hook, "plan"], { cwd: root, input: paths.join("\n") + "\n", encoding: "utf8" }).trim().split("\n").filter(Boolean);
}

test("change selection covers configuration, helper crates, and release tooling", () => {
  assert.deepEqual(plan(["README.md"]), []);
  assert.deepEqual(plan(["src/features/example.ts"]), ["frontend", "tasks"]);
  assert.deepEqual(plan(["src-tauri/services/peer-transport/Cargo.toml"]), ["rust-desktop"]);
  assert.deepEqual(plan(["cli/tasks/release/setup-keys.ts"]), ["tasks"]);
  assert.deepEqual(plan(["server/internal/billingadapter/http.go"]), ["server"]);
  assert.deepEqual(plan([".githooks/checks.sh"]), ["frontend", "server", "rust-cli", "rust-desktop", "tasks", "billing"]);
});

test("pre-commit refuses to validate unstaged code instead of the staged snapshot", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "misty-hook-test-"));
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: directory, stdio: "ignore" });
    git("init");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.invalid");
    writeFileSync(resolve(directory, "fixture"), "original");
    git("add", "fixture");
    git("-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture");
    writeFileSync(resolve(directory, "fixture"), "staged");
    git("add", "fixture");
    writeFileSync(resolve(directory, "fixture"), "different working tree");
    mkdirSync(resolve(directory, ".githooks"));
    copyFileSync(hook, resolve(directory, ".githooks/checks.sh"));
    const result = spawnSync("bash", [hook, "commit"], { cwd: directory, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /tests match the staged snapshot/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a failed first check aborts the suite instead of being masked by a later success", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "misty-hook-failure-"));
  try {
    const npm = resolve(directory, "npm");
    writeFileSync(npm, '#!/bin/sh\necho "$*"\nif [ "$*" = "run typecheck" ]; then exit 37; fi\n', { mode: 0o755 });
    const result = spawnSync("bash", [hook, "frontend"], {
      cwd: root, encoding: "utf8", env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    });
    assert.equal(result.status, 37);
    assert.match(result.stdout, /run typecheck/);
    assert.doesNotMatch(result.stdout, /run lint|✓ frontend/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
