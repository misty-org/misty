import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// sdk:sync publishes this manifest only after npm has installed both packages.
// Its content also changes Vite's browser hash for excluded dependency URLs.
export function publicSdkRevision(root) {
  try {
    return createHash("sha256")
      .update(readFileSync(resolve(root, "vendor/misty-sdk/snapshot.json")))
      .digest("hex");
  } catch (error) {
    if (error.code === "ENOENT") return "none";
    throw error;
  }
}

/** @returns {import('vite').Plugin} */
export function publicSdkDevelopmentUpdates() {
  let root;
  let revision;
  return {
    name: "misty-public-sdk-updates",
    apply: "serve",
    config(config) {
      root = resolve(config.root ?? process.cwd());
      revision = publicSdkRevision(root);
      return {
        optimizeDeps: {
          esbuildOptions: { define: { __MISTY_SDK_REVISION__: JSON.stringify(revision) } },
        },
      };
    },
    configureServer(server) {
      const manifest = resolve(root, "vendor/misty-sdk/snapshot.json");
      let restarting = false;
      const refresh = (path) => {
        if (resolve(path) !== manifest || restarting || publicSdkRevision(root) === revision)
          return;
        restarting = true;
        server.config.logger.info("Misty SDK updated; refreshing the development module cache.");
        void server.restart(true).catch((error) => {
          restarting = false;
          server.config.logger.error(`SDK refresh failed: ${error.message}`);
        });
      };
      server.watcher.add(manifest);
      server.watcher.on("change", refresh);
      server.watcher.on("add", refresh);
      server.httpServer?.once("close", () => {
        server.watcher.off("change", refresh);
        server.watcher.off("add", refresh);
      });
    },
  };
}
