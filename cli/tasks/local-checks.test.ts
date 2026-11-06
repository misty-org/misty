import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const hook = resolve(root, ".githooks/checks.sh");
function plan(paths: string[]) {
  return execFileSync("bash", [hook, "plan"], { cwd: root, input: paths.join("\n") + "\n", encoding: "utf8" }).trim().split("\n").filter(Boolean);
}

test("change selection covers configuration, helper crates, and release tooling", () => {
  assert.deepEqual(plan(["README.md"]), []);
  assert.deepEqual(plan(["src/features/example.ts"]), ["scripts", "frontend"]);
  assert.deepEqual(plan(["src-tauri/services/peer-transport/Cargo.toml"]), ["rust-desktop"]);
  assert.deepEqual(plan(["cli/tasks/release/setup-keys.ts"]), ["scripts"]);
  assert.deepEqual(plan(["src-tauri/services/agent-runtime/src/index.ts"]), ["rust-desktop", "agent-runtime"]);
  assert.deepEqual(plan([".githooks/checks.sh"]), ["scripts", "rust-cli", "rust-desktop", "agent-runtime", "frontend"]);
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

test("a failed check fails its suite even when the checks beside it pass", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "misty-hook-failure-"));
  try {
    const npm = resolve(directory, "npm");
    writeFileSync(npm, '#!/bin/sh\necho "$*"\nif [ "$*" = "run typecheck" ]; then exit 37; fi\n', { mode: 0o755 });
    const result = spawnSync("bash", [hook, "frontend"], {
      cwd: root, encoding: "utf8", env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    });
    // Steps run in parallel, so lint still runs; the suite must fail anyway,
    // with the failing step's own exit code and output.
    assert.equal(result.status, 37);
    // Output streams live, prefixed with the step's name, so the failing step is
    // named by its own "✗" line and its output carries its prefix.
    assert.match(result.stdout, /\[frontend-typecheck\] run typecheck/);
    assert.match(result.stdout, /✗ frontend-typecheck/);
    assert.match(result.stdout, /✓ frontend-lint/);
    assert.doesNotMatch(result.stdout, /✓ frontend \(/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

/** A repository with a staged source file, and stand-ins for the tools a commit calls. */
function commitFixture(npm: string) {
  const directory = mkdtempSync(resolve(tmpdir(), "misty-hook-commit-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: directory, stdio: "ignore" });
  git("init");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  mkdirSync(resolve(directory, "src"));
  writeFileSync(resolve(directory, "src/example.ts"), "staged");
  git("add", "src/example.ts");
  const tools = resolve(directory, ".tools");
  mkdirSync(tools);
  writeFileSync(resolve(directory, ".git/info/exclude"), ".tools\n");
  writeFileSync(resolve(tools, "npm"), `#!/bin/sh\n${npm}\n`, { mode: 0o755 });
  writeFileSync(resolve(tools, "docker"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return { directory, env: { ...process.env, PATH: `${tools}:${process.env.PATH}` } };
}

test("a commit stops at its limit, says what it left, and isn't refused for it", () => {
  const { directory, env } = commitFixture("sleep 60");
  try {
    const began = Date.now();
    const result = spawnSync("bash", [hook, "commit"], {
      cwd: directory, encoding: "utf8", env: { ...env, MISTY_COMMIT_SECONDS: "3" },
    });
    assert.ok(Date.now() - began < 20_000, "the limit didn't stop the suite");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Stopped at the \d+s limit/);
    assert.match(result.stdout, /frontend/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a limit used up before the suites start doesn't turn into no limit", () => {
  const { directory, env } = commitFixture("sleep 60");
  try {
    const began = Date.now();
    const result = spawnSync("bash", [hook, "commit"], {
      cwd: directory, encoding: "utf8", env: { ...env, MISTY_COMMIT_SECONDS: "0" },
    });
    assert.ok(Date.now() - began < 20_000, "the suites ran with no limit");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Stopped at the \d+s limit/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a suite that ignores being asked to stop can't hold a commit", () => {
  const { directory, env } = commitFixture("trap '' TERM; sleep 60");
  try {
    const began = Date.now();
    const result = spawnSync("bash", [hook, "commit"], {
      cwd: directory, encoding: "utf8", env: { ...env, MISTY_COMMIT_SECONDS: "2" },
      timeout: 40_000,
    });
    assert.ok(Date.now() - began < 20_000, "a stubborn suite held the commit");
    assert.equal(result.status, 0, result.stderr);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a commit stops at the first failing suite and is refused", () => {
  const { directory, env } = commitFixture('echo "$*"; exit 37');
  try {
    const result = spawnSync("bash", [hook, "commit"], { cwd: directory, encoding: "utf8", env });
    assert.equal(result.status, 37);
    assert.match(result.stdout, /── scripts/);
    assert.doesNotMatch(result.stdout, /── frontend/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a commit and a push never compile for other platforms", () => {
  const source = readFileSync(hook, "utf8");
  assert.doesNotMatch(source.match(/^rust_desktop\(\).*$/m)?.[0] ?? "", /desktop-windows/);
  assert.match(source, /release\) sequence 0 secrets .* desktop-windows/);
});
