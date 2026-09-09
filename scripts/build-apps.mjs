import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const appsRoot = resolve(import.meta.dirname, "..");
const hostRoot = resolve(process.env.MISTY_HOST_ROOT || resolve(appsRoot, "../misty"));
const result = spawnSync(process.execPath, [resolve(hostRoot, "scripts/build-official-app-packages.mjs"), ...process.argv.slice(2)], {
  cwd: hostRoot,
  env: { ...process.env, MISTY_APPS_ROOT: appsRoot },
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
