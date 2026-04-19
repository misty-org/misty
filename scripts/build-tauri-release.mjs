import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const configPath = path.join(root, "artifacts", "release", "tauri.release.conf.json");

await import("./prepare-tauri-release-config.mjs");
await access(configPath);

const child = spawn(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "tauri", "--", "build", "--config", configPath, ...process.argv.slice(2)],
  {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  },
);

child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Tauri release build stopped by ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
