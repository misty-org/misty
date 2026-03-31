import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifact = process.argv[2] ? resolve(appDir, process.argv[2]) : "";
const appleId = process.env.APPLE_ID ?? "";
const teamId = process.env.APPLE_TEAM_ID ?? "";
const password = process.env.APPLE_APP_SPECIFIC_PASSWORD ?? "";

if (!artifact || !existsSync(artifact)) {
  fail("Usage: npm run notarize:mac -- path/to/Misty.dmg");
}

if (!appleId || !teamId || !password) {
  fail([
    "APPLE_ID, APPLE_TEAM_ID, and APPLE_APP_SPECIFIC_PASSWORD are required for macOS notarization.",
    "This script is intentionally separate from iOS archive/export.",
  ]);
}

run("xcrun", [
  "notarytool",
  "submit",
  artifact,
  "--apple-id",
  appleId,
  "--team-id",
  teamId,
  "--password",
  password,
  "--wait",
]);

run("xcrun", ["stapler", "staple", artifact]);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: appDir,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function fail(message) {
  const lines = Array.isArray(message) ? message : [message];
  for (const line of lines) {
    console.error(line);
  }
  process.exit(1);
}
