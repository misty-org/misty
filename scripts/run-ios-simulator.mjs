import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const deviceName = process.env.TAURI_IOS_SIMULATOR_DEVICE ?? "iPhone 17";
const bundleId = process.env.TAURI_IOS_BUNDLE_ID ?? "com.misty.mobile";
const buildNumber = process.env.MISTY_IOS_BUILD_NUMBER ?? "1";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: appDir,
    stdio: "inherit",
    env: { ...process.env, ...options.env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function output(command, args) {
  const result = spawnSync(command, args, {
    cwd: appDir,
    encoding: "utf8",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

function simulatorDevice(name) {
  const json = output("xcrun", ["simctl", "list", "devices", "available", "--json"]);
  const payload = JSON.parse(json);
  const candidates = Object.values(payload.devices ?? {})
    .flat()
    .filter((device) => device?.name === name && device?.isAvailable);
  const booted = candidates.find((device) => device.state === "Booted");
  const selected = booted ?? candidates[0];
  if (!selected?.udid) {
    console.error(`Could not find an available iOS simulator named "${name}".`);
    process.exit(1);
  }
  return selected;
}

function simulatorAppPath() {
  const candidates = [
    "src-tauri/gen/apple/build/misty-desktop_iOS.xcarchive/Products/Applications/Misty.app",
    "src-tauri/gen/apple/build/Payload/Misty.app",
  ].map((path) => resolve(appDir, path));
  const appPath = candidates.find((path) => existsSync(path));
  if (!appPath) {
    console.error("Could not find the built Misty.app simulator bundle.");
    process.exit(1);
  }
  return appPath;
}

const clang = output("xcrun", ["--sdk", "iphonesimulator", "--find", "clang"]);
run("npm", ["run", "service:archive:ios-simulator"]);
run("npm", [
  "run",
  "tauri",
  "--",
  "ios",
  "build",
  "--debug",
  "--target",
  "aarch64-sim",
  "--features",
  "embedded-storage-go",
  "--no-sign",
  "--archive-only",
], {
  env: {
    SWIFT_RS_CLANG: clang,
    MISTY_SERVICE_GO_LIB_DIR: "src-tauri/target/misty-service/ios-simulator-arm64",
    VITE_MISTY_IOS_BUILD_NUMBER: buildNumber,
  },
});

run("/usr/libexec/PlistBuddy", [
  "-c",
  `Set :CFBundleVersion ${buildNumber}`,
  "src-tauri/gen/apple/misty-desktop_iOS/Info.plist",
]);

const device = simulatorDevice(deviceName);
const udid = device.udid;
const appPath = simulatorAppPath();
const appInfoPlist = resolve(appPath, "Info.plist");

if (existsSync(appInfoPlist)) {
  run("/usr/libexec/PlistBuddy", ["-c", `Set :CFBundleVersion ${buildNumber}`, appInfoPlist]);
}

if (device.state !== "Booted") {
  run("xcrun", ["simctl", "boot", udid]);
  run("xcrun", ["simctl", "bootstatus", udid, "-b"]);
}
run("open", ["-a", "Simulator"]);
run("xcrun", ["simctl", "install", udid, appPath]);
run("xcrun", ["simctl", "launch", udid, bundleId]);
