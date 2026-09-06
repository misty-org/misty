import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const appsRoot = resolve(process.env.MISTY_APPS_ROOT?.trim() || resolve(root, "../misty-apps"));
const catalogPath = process.env.MISTY_OFFICIAL_APP_CATALOG_PATH || `${appsRoot}/apps/catalog.json`;
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

for (const app of apps) {
  for (const platform of ["desktop", "mobile"]) {
    if (platform === "desktop" && app.desktop.runtime !== "downloaded") continue;
    if (platform === "mobile" && app.mobile.runtime !== "hosted") continue;
    const output = resolve(appsRoot, ".build/official-apps", app.id, platform);
    await rm(output, { recursive: true, force: true });
    await mkdir(output, { recursive: true });
    await runVite(app.id, platform, output);
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
          ...process.env,
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
