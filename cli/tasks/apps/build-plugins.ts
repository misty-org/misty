import { spawnSync } from "node:child_process";
import { nativeServicesForApp } from "./package-native-services.ts";
import { packageExtensionServices } from "./package-extension-services.ts";
import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, "../../../apps");
const dist = path.join(repo, "dist");
const pluginsSrc = path.join(repo, "extensions");
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
  await cp(path.join(srcDir, "tools"), path.join(destDir, "tools"), { recursive: true }).catch(() => undefined);
  await cp(path.join(srcDir, "THIRD_PARTY_NOTICES.md"), path.join(destDir, "THIRD_PARTY_NOTICES.md")).catch(() => undefined);
  const manifest = JSON.parse(await readFile(path.join(destDir, "manifest.json"), "utf8"));
  if (process.platform === "darwin") {
    for (const [service] of nativeServicesForApp(manifest.id)) {
      const built = spawnSync(process.execPath, [path.join(root, "build-native-services.ts"), "", service], {stdio: "inherit"});
      if (built.error) throw built.error;
      if (built.status !== 0) throw new Error(`Could not build ${service}.`);
    }
  }
  await packageExtensionServices(repo, manifest, destDir, { release: process.argv.includes("--release") });
  const webDir = path.join(destDir, "web");
  await mkdir(webDir, { recursive: true });
  await cp(path.join(dist, "index.html"), path.join(webDir, "index.html"));
  await cp(path.join(dist, "assets"), path.join(webDir, "assets"), { recursive: true });
}

await cp(path.join(repo, "catalog"), path.join(dist, "catalog"), { recursive: true });
