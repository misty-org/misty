import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const developmentTeam = process.env.APPLE_DEVELOPMENT_TEAM ?? process.env.MISTY_IOS_DEVELOPMENT_TEAM ?? "";
const bundleId = process.env.TAURI_IOS_BUNDLE_ID ?? process.env.MISTY_IOS_BUNDLE_ID ?? "com.misty.mobile";
const buildNumber = process.env.MISTY_IOS_BUILD_NUMBER ?? "1";
const skipSigningPreflight = process.env.MISTY_IOS_SKIP_SIGNING_PREFLIGHT === "1";
const preflightOnly = process.argv.includes("--preflight-only");

preflight();

if (preflightOnly) {
  console.log("Validated iOS device dev preflight. No device build was started because --preflight-only was used.");
  process.exit(0);
}

const clang = output("xcrun", ["--sdk", "iphoneos", "--find", "clang"]);
run("npm", ["run", "service:archive:ios"]);
run("npm", [
  "run",
  "tauri",
  "--",
  "ios",
  "dev",
  "--host",
  "--features",
  "embedded-storage-go",
], {
  SWIFT_RS_CLANG: clang,
  MISTY_SERVICE_GO_LIB_DIR: "src-tauri/target/misty-service/ios-arm64",
  TAURI_IOS_BUNDLE_ID: bundleId,
  APPLE_DEVELOPMENT_TEAM: developmentTeam,
  DEVELOPMENT_TEAM: developmentTeam,
  VITE_MISTY_IOS_BUILD_NUMBER: buildNumber,
});

function preflight() {
  if (!developmentTeam.trim()) {
    fail([
      "APPLE_DEVELOPMENT_TEAM or MISTY_IOS_DEVELOPMENT_TEAM is required for iOS device development.",
      "Set it to the Apple Developer Team ID that owns the iOS bundle identifier.",
    ]);
  }
  if (!/^[A-Z0-9]{10}$/.test(developmentTeam.trim())) {
    fail([
      `Apple Developer Team ID "${developmentTeam}" does not look like a 10-character team ID.`,
      "Use the Team ID from Apple Developer > Membership or Xcode > Settings > Accounts.",
    ]);
  }

  output("xcrun", ["--find", "xcodebuild"]);
  output("xcrun", ["--sdk", "iphoneos", "--find", "clang"]);

  if (skipSigningPreflight) {
    console.warn("Skipping local Apple Development identity preflight because MISTY_IOS_SKIP_SIGNING_PREFLIGHT=1.");
    return;
  }

  const identities = output("security", ["find-identity", "-v", "-p", "codesigning"], { allowFailure: true });
  if (!identities.includes("Apple Development")) {
    fail([
      'No local "Apple Development" code-signing identity was found for iOS device development.',
      "Open Xcode > Settings > Accounts, sign in with the Apple Developer account, select the team, and download/create signing certificates.",
      "If signing is installed by another CI/keychain step, set MISTY_IOS_SKIP_SIGNING_PREFLIGHT=1 only after that step is proven.",
    ]);
  }
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: appDir,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function output(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: appDir,
    encoding: "utf8",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    fail([
      `${command} ${args.join(" ")} failed.`,
      result.stderr.trim() || result.stdout.trim() || "No command output was returned.",
    ]);
  }
  return result.stdout.trim();
}

function fail(message) {
  const lines = Array.isArray(message) ? message : [message];
  console.error(lines.join("\n"));
  process.exit(1);
}
