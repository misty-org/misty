import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { connect } from "node:net";
import { test } from "node:test";
import { toolCommand, toolingRoot } from "./tooling.ts";
import { getFileInfo } from "prettier";

test("Prettier keeps generated files ignored after relocating its ignore file", async () => {
  const command = toolCommand("prettier", ["--check", "--", "src/app/entry.ts"]);
  const ignorePath = command.args.flatMap((arg, index) =>
    arg === "--ignore-path" ? [command.args[index + 1]] : [],
  );
  assert.deepEqual(ignorePath, [
    resolve(toolingRoot, ".gitignore"),
    resolve(toolingRoot, ".config/prettierignore"),
  ]);
  for (const file of ["dist/entry.js", "coverage/report.js", "src-tauri/gen/apple/generated.ts"]) {
    assert.equal(
      (await getFileInfo(resolve(toolingRoot, file), { ignorePath })).ignored,
      true,
      file,
    );
  }
  assert.equal(
    (await getFileInfo(resolve(toolingRoot, "src/app/entry.ts"), { ignorePath })).ignored,
    false,
  );
  assert.throws(
    () => toolCommand("prettier", ["--ignore-path=other"]),
    /override is not supported/,
  );
});

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

const portAnswers = (port: number) =>
  new Promise<boolean>((done) => {
    const socket = connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      done(true);
    });
    socket.once("error", () => done(false));
  });

async function until(check: () => Promise<boolean>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((wait) => setTimeout(wait, 100));
  }
  return false;
}

test("stopping the runner stops the dev server under it", async () => {
  const port = 5190 + Math.floor(Math.random() * 100);
  const runner = spawn(
    process.execPath,
    [resolve(toolingRoot, "cli/tasks/run-tool.ts"), "vite", "--port", String(port), "--strictPort"],
    { stdio: "ignore" },
  );
  const exited = new Promise<number | null>((done) => runner.once("exit", (code) => done(code)));
  try {
    assert.ok(await until(() => portAnswers(port), 30_000), "Vite never started listening");
    runner.kill("SIGTERM");
    assert.equal(await exited, 128 + 15);
    assert.ok(
      await until(async () => !(await portAnswers(port)), 5_000),
      "Vite outlived the runner",
    );
  } finally {
    runner.kill("SIGKILL");
  }
});

test("force-killing what started the runner stops the dev server under it", async () => {
  const port = 5290 + Math.floor(Math.random() * 100);
  const runTool = resolve(toolingRoot, "cli/tasks/run-tool.ts");
  // The trailing `:` keeps sh from exec-ing into node, so sh stays the runner's parent.
  const shell = spawn(
    "sh",
    ["-c", `"${process.execPath}" "${runTool}" vite --port ${port} --strictPort; :`],
    { stdio: "ignore" },
  );
  try {
    assert.ok(await until(() => portAnswers(port), 30_000), "Vite never started listening");
    shell.kill("SIGKILL");
    assert.ok(
      await until(async () => !(await portAnswers(port)), 15_000),
      "Vite outlived the shell that started it",
    );
  } finally {
    shell.kill("SIGKILL");
  }
});
