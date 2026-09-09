import { pathToFileURL } from "node:url";
import { loadAppEnv } from "./app-env.mjs";
import { localAppsDirectory } from "./local-apps-directory.mjs";
import { spawn } from "node:child_process";
import { stagedAppBuild } from "./staged-app-build.mjs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const developmentEnv = loadAppEnv(root);
const appsRoot = resolve(developmentEnv.MISTY_APPS_ROOT?.trim() || localAppsDirectory(developmentEnv.VITE_MISTY_APPS_DIRECTORY ?? developmentEnv.MISTY_APPS_DIRECTORY, root) || resolve(root, "../misty-apps"));
const catalogPath = developmentEnv.MISTY_OFFICIAL_APP_CATALOG_PATH || `${appsRoot}/apps/catalog.json`;
const catalog = await import(catalogPath, { with: { type: "json" } }).then(
  (module) => module.default,
);
const selected = process.argv.slice(2).filter((value) => !value.startsWith("--"));
const selectedApps = selected.length
  ? catalog.apps.filter((app) => selected.includes(app.id))
  : catalog.apps;
const apps = selectedApps.filter(
  (app) => app.desktop.runtime === "downloaded" || app.mobile.runtime === "hosted",
);

if (!apps.length) {
  console.log(
    "All selected official apps are compiled into the trusted Host; no package build is needed.",
  );
}

// Native services are package assets, never inputs to the Host frontend build.
const { nativeServicesForApp } = await import(pathToFileURL(resolve(appsRoot, "scripts/package-native-services.mjs")).href);
const nativeServices = new Set(apps
  .filter(app => app.desktop.runtime === "downloaded")
  .flatMap(app => nativeServicesForApp(app.id).map(([service]) => service)));
if (process.platform === "darwin") {
  for (const service of nativeServices) {
    await new Promise((resolveRun, reject) => {
      const child = spawn(process.execPath, [resolve(appsRoot, "scripts/build-native-services.mjs"), "", service], {cwd:appsRoot,env:developmentEnv,stdio:"inherit"});
      child.on("error", reject);
      child.on("close", code => code === 0 ? resolveRun() : reject(new Error(`Could not build the ${service} native service.`)));
    });
  }
}

for (const app of apps) {
  for (const platform of (process.argv.includes("--desktop-only") ? ["desktop"] : ["desktop", "mobile"])) {
    if (platform === "desktop" && app.desktop.runtime !== "downloaded") continue;
    if (platform === "mobile" && app.mobile.runtime !== "hosted") continue;
    const output = resolve(appsRoot, ".build/official-apps", app.id, platform);
    await stagedAppBuild(output, (stagedOutput) => runVite(app.id, platform, stagedOutput));
  }
}

function runVite(appId, platform, output) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(
      process.execPath,
      [
        resolve(root, "node_modules/vite/bin/vite.js"),
        "build",
        "--config",
        resolve(root, "vite.official-app.config.ts"),
        "--mode",
        platform,
      ],
      {
        cwd: root,
        env: {
          ...developmentEnv,
          MISTY_APPS_ROOT: appsRoot,
          MISTY_OFFICIAL_APP_ID: appId,
          MISTY_OFFICIAL_APP_PLATFORM: platform,
          MISTY_OFFICIAL_APP_OUT_DIR: output,
        },
        stdio: "inherit",
      },
    );
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolveRun() : reject(new Error(`Could not build ${appId} for ${platform}.`)),
    );
  });
}
