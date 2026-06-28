import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const host = process.env.MISTY_WEB_DEV_HOST ?? "127.0.0.1";
const port = process.env.MISTY_WEB_DEV_PORT ?? "5174";
const env = {
  ...process.env,
  VITE_MISTY_TARGET: process.env.VITE_MISTY_TARGET ?? "web",
  VITE_MISTY_NATIVE_BRIDGE_URL: process.env.VITE_MISTY_NATIVE_BRIDGE_URL ?? "http://127.0.0.1:17888",
  VITE_MISTY_SERVER_URL: process.env.VITE_MISTY_SERVER_URL ?? "http://localhost:8080",
  VITE_API_BASE: process.env.VITE_API_BASE ?? "http://localhost:8080",
};

const result = spawnSync(npm, [
  "exec",
  "vite",
  "--",
  "--mode",
  "web",
  "--host",
  host,
  "--port",
  port,
  ...process.argv.slice(2),
], {
  cwd: appDir,
  stdio: "inherit",
  env,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
