import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAppEnv } from "./app-env.mjs";
import { localAppsDirectory } from "./local-apps-directory.mjs";

export function prepareDesktopApps(root, environment = process.env, run = execFileSync) {
  const env = loadAppEnv(root, environment);
  const appsRoot = localAppsDirectory(env.VITE_MISTY_APPS_DIRECTORY ?? env.MISTY_APPS_DIRECTORY, root);
  if (!appsRoot) return;
  const catalogPath = resolve(appsRoot, "apps/catalog.json");
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  const missing = catalog.apps.filter((app) => {
    if (app.desktop?.runtime !== "downloaded") return false;
    if (!/^[a-z0-9_-]+$/.test(app.id)) throw new Error("Invalid local App identity.");
    return !["app.js", "app.css"].every((file) =>
      existsSync(resolve(appsRoot, ".build/official-apps", app.id, "desktop", file)));
  }).map((app) => app.id);
  if (!missing.length) return;
  console.log(`Building local desktop Apps: ${missing.join(", ")}…`);
  run(process.execPath, [resolve(root, "scripts/build-official-app-packages.mjs"), ...missing], {
    cwd: root,
    env: { ...env, MISTY_APPS_ROOT: appsRoot, MISTY_OFFICIAL_APP_CATALOG_PATH: catalogPath },
    stdio: "inherit",
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  prepareDesktopApps(resolve(import.meta.dirname, ".."));
