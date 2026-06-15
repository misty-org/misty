import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { officialAppDevelopmentPath } from "./official-app-development-paths.mjs";

export function missingDesktopPackages(catalog, assetsRoot) {
  return catalog.apps.filter((app) => {
    if (app.desktop?.runtime !== "downloaded") return false;
    if (!/^[a-z0-9_-]+$/.test(app.id) || !/^[a-zA-Z0-9._-]+$/.test(app.version))
      throw new Error("The local App catalog contains an invalid package identity.");
    const archive = resolve(assetsRoot, app.id, app.version, "desktop.zip");
    return !existsSync(archive) ||
      createHash("sha256").update(readFileSync(archive)).digest("hex") !== app.desktop.sha256;
  }).map((app) => app.id);
}

export function prepareDesktopApps(root, environment = process.env, run = execFileSync) {
  const env = { ...loadEnv("desktop", root, ""), ...environment };
  const catalogPath = officialAppDevelopmentPath(env.MISTY_OFFICIAL_APPS_CATALOG, root, "apps/catalog.json");
  if (!existsSync(catalogPath)) return; // Remote-catalog development needs no local build.
  const assetsRoot = officialAppDevelopmentPath(env.MISTY_OFFICIAL_APPS_DIR, root, "public/official-apps", { allowMissingGeneratedAssets: true });
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  const missing = missingDesktopPackages(catalog, assetsRoot);
  if (!missing.length) return;
  const appsRoot = dirname(dirname(catalogPath));
  if (resolve(appsRoot, "public/official-apps") !== assetsRoot ||
      !existsSync(resolve(appsRoot, "scripts/build-official-apps.mjs")))
    throw new Error(`Build the missing local App packages (${missing.join(", ")}) at the configured assets path: ${assetsRoot}`);
  console.log(`Preparing downloadable desktop Apps: ${missing.join(", ")}…`);
  const options = { cwd: root, env: { ...environment, MISTY_APPS_ROOT: appsRoot, MISTY_OFFICIAL_APP_CATALOG_PATH: catalogPath }, stdio: "inherit" };
  run(process.execPath, [resolve(root, "scripts/build-official-app-packages.mjs"), ...missing], options);
  run(process.execPath, [resolve(appsRoot, "scripts/build-official-apps.mjs"), ...missing], { ...options, cwd: appsRoot });
  const updated = JSON.parse(readFileSync(catalogPath, "utf8"));
  if (missingDesktopPackages(updated, assetsRoot).length) throw new Error("The desktop App packages could not be prepared.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  prepareDesktopApps(resolve(import.meta.dirname, ".."));
