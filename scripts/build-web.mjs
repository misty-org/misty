import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const outDir = process.env.MISTY_WEB_OUT_DIR ?? "dist-web";
const env = {
  ...process.env,
  VITE_MISTY_TARGET: process.env.VITE_MISTY_TARGET ?? "web",
  VITE_MISTY_NATIVE_BRIDGE_URL: process.env.VITE_MISTY_NATIVE_BRIDGE_URL ?? "http://127.0.0.1:17888",
  VITE_MISTY_SERVER_URL: process.env.VITE_MISTY_SERVER_URL ?? "http://localhost:8080",
  VITE_API_BASE: process.env.VITE_API_BASE ?? "http://localhost:8080",
};

run(["exec", "tsc", "--"]);
run(["exec", "vite", "--", "build", "--mode", "web", "--outDir", outDir]);

function run(args) {
  const result = spawnSync(npm, args, {
    cwd: appDir,
    stdio: "inherit",
    env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
