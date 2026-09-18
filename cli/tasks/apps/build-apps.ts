import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const appsRoot = resolve(import.meta.dirname, "../../../apps");
const hostRoot = resolve(process.env.MISTY_HOST_ROOT || resolve(appsRoot, ".."));
const result = spawnSync(process.execPath, [resolve(hostRoot, "cli/tasks/build-official-app-packages.ts"), ...process.argv.slice(2)], {
  cwd: hostRoot,
  env: { ...process.env, MISTY_APPS_ROOT: appsRoot },
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
