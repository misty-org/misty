import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stagedAppBuild } from "./staged-app-build.mjs";

test("keeps the current package readable while building and after failure, then publishes complete replacements", async () => {
  const root = await mkdtemp(join(tmpdir(), "misty-build-test-"));
  const output = join(root, "desktop");
  try {
    await mkdir(output);
    await writeFile(join(output, "app.js"), "old app");
    await writeFile(join(output, "app.css"), "old styles");
    await assert.rejects(stagedAppBuild(output, async (staged) => {
      await mkdir(staged, { recursive: true });
      await writeFile(join(staged, "app.js"), "broken app");
      assert.equal(await readFile(join(output, "app.js"), "utf8"), "old app");
      throw new Error("compiler failed");
    }), /compiler failed/);
    assert.equal(await readFile(join(output, "app.js"), "utf8"), "old app");
    await stagedAppBuild(output, async (staged) => {
      await mkdir(staged, { recursive: true });
      assert.equal(await readFile(join(output, "app.css"), "utf8"), "old styles");
      await writeFile(join(staged, "app.js"), "new app");
      await writeFile(join(staged, "app.css"), "new styles");
    });
    assert.equal(await readFile(join(output, "app.js"), "utf8"), "new app");
    assert.equal(await readFile(join(output, "app.css"), "utf8"), "new styles");
    assert.deepEqual(await readdir(root), ["desktop"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
