import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAppEnv } from "./app-env.ts";
import { localAppsDirectory } from "./local-apps-directory.ts";

function newestSource(path) {
  if (!existsSync(path)) return 0;
  const info = statSync(path);
  if (!info.isDirectory()) return info.mtimeMs;
  return Math.max(info.mtimeMs, ...readdirSync(path, { withFileTypes: true })
    .filter(entry => !entry.isSymbolicLink() && !["node_modules", ".git", ".build", "dist", "target"].includes(entry.name))
    .map(entry => newestSource(resolve(path, entry.name))));
}

function desktopAppBuild(root, environment, selected) {
  const env = loadAppEnv(root, environment);
  const appsRoot = localAppsDirectory(env.VITE_MISTY_APPS_DIRECTORY ?? env.MISTY_APPS_DIRECTORY, root);
  if (!appsRoot) return null;
  const catalogPath = resolve(appsRoot, "catalog.json");
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  // Packages import Host UI modules and shared App code. Changes to either
  // invalidate local bundles; existence alone cannot establish freshness.
  const sharedChanged = Math.max(
    newestSource(resolve(root, "src")),
    newestSource(resolve(appsRoot, "apps/shared")),
    newestSource(resolve(root, "package-lock.json")),
    newestSource(resolve(root, "vite.official-app.config.ts")),
  );
  const apps = catalog.apps.filter((app) =>
    app.id !== "agents" && app.desktop?.runtime === "downloaded" &&
    (!selected || app.id === selected));
  if (!apps.length) return null;
  const missing = apps.filter((app) => {
    if (!/^[a-z0-9_-]+$/.test(app.id)) throw new Error("Invalid local App identity.");
    const changed = Math.max(sharedChanged, newestSource(resolve(appsRoot, app.id)));
    return !["app.js", "app.css"].every((file) => {
      const output = resolve(appsRoot, ".build/official-apps", app.id, "desktop", file);
      return existsSync(output) && statSync(output).mtimeMs >= changed;
    });
  }).map((app) => app.id);
  return {
    missing,
    args: [resolve(root, "cli/tasks/build-official-app-packages.ts"), ...missing, "--desktop-only"],
    options: {
      cwd: root,
      env: { ...env, MISTY_APPS_ROOT: appsRoot, MISTY_OFFICIAL_APP_CATALOG_PATH: catalogPath },
      stdio: "inherit",
    },
  };
}

export function prepareDesktopApps(root, environment = process.env, run = execFileSync) {
  const build = desktopAppBuild(root, environment);
  if (!build?.missing.length) return;
  console.log(`Building local desktop Apps: ${build.missing.join(", ")}…`);
  run(process.execPath, build.args, build.options);
}

function runBuild(executable, args, options) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(executable, args, options);
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolveRun() : reject(new Error(`Local app build exited with code ${code}.`)));
  });
}

// Start the host immediately. Only requests for a local app wait for its build.
// Share JS/CSS requests and serialize builds to avoid competing bundlers.
export function createDesktopAppPreparation(root, environment = process.env, run = runBuild) {
  const pending = new Map();
  let queue = Promise.resolve();
  return (appId) => {
    if (!/^[a-z0-9_-]+$/.test(appId)) return Promise.resolve(false);
    if (pending.has(appId)) return pending.get(appId);
    const request = queue.then(async () => {
      const build = desktopAppBuild(root, environment, appId);
      if (!build) return false;
      if (build.missing.length) {
        console.log(`Preparing local desktop App: ${appId}…`);
        await run(process.execPath, build.args, build.options);
      }
      return true;
    }).finally(() => pending.delete(appId));
    pending.set(appId, request);
    // A failed build must not block another app or a retry after fixing source.
    queue = request.catch(() => {});
    return request;
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  prepareDesktopApps(resolve(import.meta.dirname, "../.."));
