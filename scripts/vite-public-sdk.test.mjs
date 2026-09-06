import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rename, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import { publicSdkDevelopmentUpdates } from "./vite-public-sdk.mjs";

test(
  "a completed SDK sync restarts Vite and changes cached dependency URLs",
  { timeout: 25000 },
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "misty-sdk-cache-test-")));
    let server;
    try {
      const sdk = join(root, "node_modules/@misty/sdk");
      const manifest = join(root, "vendor/misty-sdk/snapshot.json");
      await mkdir(sdk, { recursive: true });
      await mkdir(join(root, "vendor/misty-sdk"), { recursive: true });
      await writeFile(join(root, "package.json"), JSON.stringify({ type: "module" }));
      await writeFile(
        join(sdk, "package.json"),
        JSON.stringify({
          name: "@misty/sdk",
          version: "0.1.0",
          type: "module",
          exports: "./index.js",
        }),
      );
      await writeFile(join(sdk, "index.js"), "export const original = 1;");
      await writeFile(manifest, JSON.stringify({ revision: "first" }));
      await writeFile(join(root, "index.html"), '<script type="module" src="/entry.js"></script>');
      await writeFile(
        join(root, "entry.js"),
        'import * as sdk from "@misty/sdk"; console.log(sdk);',
      );
      server = await createServer({
        root,
        configFile: false,
        logLevel: "error",
        plugins: [publicSdkDevelopmentUpdates()],
        optimizeDeps: { exclude: ["@misty/sdk"] },
        server: { host: "127.0.0.1", port: 0 },
      });
      await server.listen();
      const before = (await server.transformRequest("/entry.js")).code;
      const dependencyUrl = (code) => code.match(/"([^"\n]*node_modules\/[^"\n]+)"/)?.[1];
      const firstUrl = dependencyUrl(before);
      assert.ok(firstUrl?.includes("?v="), before);
      await writeFile(
        join(sdk, "index.js"),
        "export const original = 1; export const MistyWorkspaceSnapshotSchema = {};",
      );
      // Updating package bytes alone is not a completed SDK sync.
      assert.equal(dependencyUrl((await server.transformRequest("/entry.js")).code), firstUrl);
      await writeFile(`${manifest}.tmp`, JSON.stringify({ revision: "second" }));
      await rename(`${manifest}.tmp`, manifest);
      let after;
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        try {
          after = dependencyUrl((await server.transformRequest("/entry.js"))?.code ?? "");
          if (after && after !== firstUrl) break;
        } catch {
          /* The listener is unavailable briefly during restart. */
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(after && after !== firstUrl, `Expected new dependency URL, got ${after}`);
      const response = await server.transformRequest(after);
      assert.match(response.code, /export const MistyWorkspaceSnapshotSchema/);
    } finally {
      await server?.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
