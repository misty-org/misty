import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { resolve } from "node:path";
import { test } from "node:test";
import { ancestry, descendants, isStranded } from "./stranded.ts";

const table = new Map([
  [40, 30],
  [30, 20],
  [20, 1],
  [1, 0],
]);

test("ancestry runs from the process up to the one launchd started", () => {
  assert.deepEqual(ancestry(table, 40), [
    [40, 30],
    [30, 20],
    [20, 1],
  ]);
});

test("a process is stranded once anything above it exits or is moved", () => {
  const chain = ancestry(table, 40);
  assert.equal(isStranded(chain, table), false);
  assert.equal(
    isStranded(
      chain,
      new Map([
        [40, 30],
        [30, 1],
        [1, 0],
      ]),
    ),
    true,
  );
  assert.equal(
    isStranded(
      chain,
      new Map([
        [40, 1],
        [1, 0],
      ]),
    ),
    true,
  );
});

test("descendants lists everything under a process", () => {
  const tree = new Map([
    [10, 1],
    [11, 10],
    [12, 11],
    [13, 10],
    [20, 1],
  ]);
  assert.deepEqual(descendants(tree, 10), [11, 13, 12]);
});

const portAnswers = (port: number) =>
  new Promise<boolean>((done) => {
    const socket = connect(port, "127.0.0.1", () => {
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

test(
  "the dev server stops when whatever started it is killed outright",
  { skip: process.platform === "win32", timeout: 60_000 },
  async () => {
    const root = resolve(import.meta.dirname, "..");
    const port = 5290 + Math.floor(Math.random() * 100);
    const vite = resolve(root, "node_modules/vite/bin/vite.js");
    // The trailing `:` keeps sh from exec-ing into node, so sh stays Vite's parent.
    const shell = spawn(
      "sh",
      ["-c", `"${process.execPath}" "${vite}" --mode desktop --config .config/vite.config.ts; :`],
      { cwd: root, stdio: "ignore", env: { ...process.env, MISTY_DESKTOP_DEV_PORT: String(port) } },
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
  },
);
