import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { toolCommand, toolingRoot } from "./tooling.ts";

function fixture(t, registry = { sample: { executable: "sample", config: "sample.json" } }) {
  const root = mkdtempSync(join(tmpdir(), "misty-tooling-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".config"));
  writeFileSync(join(root, ".config/tooling.json"), JSON.stringify(registry));
  writeFileSync(join(root, ".config/sample.json"), "{}");
  return root;
}

test("passes absolute config paths and keeps positional filenames after --", (t) => {
  const root = fixture(t);
  assert.deepEqual(toolCommand("sample", ["scan", "--", "--config"], root), {
    program: "sample",
    cwd: root,
    args: ["scan", "--config", join(root, ".config/sample.json"), "--", "--config"],
  });
});

test("reports the missing config instead of using tool defaults", (t) => {
  const root = fixture(t);
  rmSync(join(root, ".config/sample.json"));
  assert.throws(() => toolCommand("sample", [], root), /Missing sample.json configuration:/);
});

test("validates secondary configs such as Tailwind", (t) => {
  const root = fixture(t, {
    sample: { executable: "sample", config: "sample.json", requires: ["missing.js"] },
  });
  assert.throws(() => toolCommand("sample", [], root), /Missing missing.js configuration:/);
});

test("rejects unknown tools, escaping config paths, and conflicting config flags", (t) => {
  const root = fixture(t, {
    sample: { executable: "sample", config: "sample.json", shortConfig: "-c" },
    escape: { executable: "sample", config: "../package.json" },
  });
  assert.throws(() => toolCommand("unknown", [], root), /Unknown tool/);
  assert.throws(() => toolCommand("escape", [], root), /must stay inside/);
  for (const args of [["--config", "other"], ["--config=other"], ["-c", "other"]])
    assert.throws(() => toolCommand("sample", args, root), /override is not supported/);
});

test("resolves the project's npm binary instead of a global installation", (t) => {
  const root = fixture(t, { sample: { package: "sample", config: "sample.json" } });
  writeFileSync(join(root, "package.json"), "{}");
  mkdirSync(join(root, "node_modules/sample"), { recursive: true });
  writeFileSync(
    join(root, "node_modules/sample/package.json"),
    JSON.stringify({ bin: { sample: "cli.js" } }),
  );
  const command = toolCommand("sample", [], root);
  assert.equal(command.program, process.execPath);
  assert.ok(command.args.includes(join(realpathSync(root), "node_modules/sample/cli.js")));
});

test("npm registry bridge works from a nested directory", () => {
  const result = spawnSync(
    process.execPath,
    [resolve(toolingRoot, "cli/tasks/run-tool.ts"), "vite", "--version"],
    {
      cwd: resolve(toolingRoot, "src/features"),
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /vite\//);
});

test("forwards tool failure exit codes", () => {
  const result = spawnSync(
    process.execPath,
    [resolve(toolingRoot, "cli/tasks/run-tool.ts"), "vite", "--misty-invalid-option"],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
});
