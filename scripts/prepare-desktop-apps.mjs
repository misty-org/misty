import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAppEnv } from "./app-env.mjs";
import { localAppsDirectory } from "./local-apps-directory.mjs";

function newestSource(path) {
  if (!existsSync(path)) return 0;
  const info = statSync(path);
  if (!info.isDirectory()) return info.mtimeMs;
  return Math.max(info.mtimeMs, ...readdirSync(path, { withFileTypes: true })
    .filter(entry => !entry.isSymbolicLink() && !["node_modules", ".git", ".build", "dist", "target"].includes(entry.name))
    .map(entry => newestSource(resolve(path, entry.name))));
}

export function prepareDesktopApps(root, environment = process.env, run = execFileSync) {
  const env = loadAppEnv(root, environment);
  const appsRoot = localAppsDirectory(env.VITE_MISTY_APPS_DIRECTORY ?? env.MISTY_APPS_DIRECTORY, root);
  if (!appsRoot) return;
  const catalogPath = resolve(appsRoot, "apps/catalog.json");
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  // Packages import Host UI modules and shared App code. Changes to either
  // invalidate local bundles; existence alone cannot establish freshness.
  const sharedChanged = Math.max(
    newestSource(resolve(root, "src")),
    newestSource(resolve(appsRoot, "apps/shared")),
    newestSource(resolve(root, "package-lock.json")),
    newestSource(resolve(root, "vite.official-app.config.ts")),
  );
  const missing = catalog.apps.filter((app) => {
    if (app.desktop?.runtime !== "downloaded") return false;
    if (!/^[a-z0-9_-]+$/.test(app.id)) throw new Error("Invalid local App identity.");
    const changed = Math.max(sharedChanged, newestSource(resolve(appsRoot, "apps", app.id)));
    return !["app.js", "app.css"].every((file) => {
      const output = resolve(appsRoot, ".build/official-apps", app.id, "desktop", file);
      return existsSync(output) && statSync(output).mtimeMs >= changed;
    });
  }).map((app) => app.id);
  if (!missing.length) return;
  console.log(`Building local desktop Apps: ${missing.join(", ")}…`);
  run(process.execPath, [resolve(root, "scripts/build-official-app-packages.mjs"), ...missing, "--desktop-only"], {
    cwd: root,
    env: { ...env, MISTY_APPS_ROOT: appsRoot, MISTY_OFFICIAL_APP_CATALOG_PATH: catalogPath },
    stdio: "inherit",
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  prepareDesktopApps(resolve(import.meta.dirname, ".."));
