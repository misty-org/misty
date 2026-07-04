import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, "..");
const dist = path.join(repo, "dist");
const pluginsSrc = path.join(repo, "plugins");
const pluginsDist = path.join(dist, "plugins");

await mkdir(pluginsDist, { recursive: true });

for (const entry of await readdir(pluginsSrc, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;

  const srcDir = path.join(pluginsSrc, entry.name);
  const destDir = path.join(pluginsDist, entry.name);
  await rm(destDir, { recursive: true, force: true });
  await mkdir(destDir, { recursive: true });

  for (const fileName of ["manifest.json", "plugin.json"]) {
    await cp(path.join(srcDir, fileName), path.join(destDir, fileName)).catch(() => undefined);
  }

  await cp(path.join(srcDir, "assets"), path.join(destDir, "assets"), { recursive: true }).catch(() => undefined);
}

await cp(path.join(repo, "catalog"), path.join(dist, "catalog"), { recursive: true });
