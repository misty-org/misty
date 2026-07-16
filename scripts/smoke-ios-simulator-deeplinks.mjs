#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deviceName = process.env.TAURI_IOS_SIMULATOR_DEVICE ?? "iPad (A16)";
const bundleId = process.env.TAURI_IOS_BUNDLE_ID ?? "com.misty.mobile";
const outputDir = path.resolve(root, process.env.MISTY_IOS_DEEPLINK_QA_DIR ?? "build/mobile-ui-qa");
const settleMs = Number(process.env.MISTY_IOS_DEEPLINK_SETTLE_MS ?? "30000");
const routeWarmupMs = Number(process.env.MISTY_IOS_ROUTE_WARMUP_MS ?? "700");
const captureWarmupMs = Number(process.env.MISTY_IOS_SCREENSHOT_WARMUP_MS ?? "350");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = result.stderr ? `\n${result.stderr}` : "";
    throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}${stderr}`);
  }
  return (result.stdout ?? "").trim();
}

function simulatorDevice(name) {
  const payload = JSON.parse(run("xcrun", ["simctl", "list", "devices", "available", "--json"]));
  const devices = Object.values(payload.devices ?? {})
    .flat()
    .filter((device) => device?.name === name && device?.isAvailable);
  const selected = devices.find((device) => device.state === "Booted") ?? devices[0];
  if (!selected?.udid) {
    throw new Error(`Could not find an available iOS simulator named "${name}".`);
  }
  return selected;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function screenshot(udid, fileName) {
  const outputPath = path.join(outputDir, fileName);
  sleep(captureWarmupMs);
  run("xcrun", ["simctl", "io", udid, "screenshot", "--mask=black", outputPath]);
  if (!existsSync(outputPath)) throw new Error(`Expected screenshot was not written: ${outputPath}`);
  return outputPath;
}

function openUrl(udid, url) {
  run("xcrun", ["simctl", "openurl", udid, url]);
  sleep(settleMs);
}

mkdirSync(outputDir, { recursive: true });
const device = simulatorDevice(deviceName);
const udid = device.udid;

if (device.state !== "Booted") {
  run("xcrun", ["simctl", "boot", udid], { stdio: "inherit" });
  run("xcrun", ["simctl", "bootstatus", udid, "-b"], { stdio: "inherit" });
}

try {
  run("xcrun", ["simctl", "get_app_container", udid, bundleId, "app"]);
} catch {
  throw new Error(`Misty is not installed on ${deviceName} (${udid}). Run npm run tauri:ios:simulator:embedded first.`);
}

const captures = [];
const startedAt = new Date().toISOString();

run("xcrun", ["simctl", "terminate", udid, bundleId], { stdio: "ignore" });
openUrl(udid, "misty://providers");
captures.push({
  label: "cold-start-providers",
  url: "misty://providers",
  expectedSurface: "Remotes",
  file: path.relative(root, screenshot(udid, "40-smoke-cold-providers.png")),
});

openUrl(udid, "misty://files");
captures.push({
  label: "foreground-files",
  url: "misty://files",
  expectedSurface: "Files",
  file: path.relative(root, screenshot(udid, "41-smoke-foreground-files.png")),
});

openUrl(udid, "misty://providers");
captures.push({
  label: "foreground-providers",
  url: "misty://providers",
  expectedSurface: "Remotes",
  file: path.relative(root, screenshot(udid, "42-smoke-foreground-providers.png")),
});

openUrl(udid, "misty://open/account/signin");
captures.push({
  label: "foreground-account-signin",
  url: "misty://open/account/signin",
  expectedSurface: "Account sign-in",
  file: path.relative(root, screenshot(udid, "43-smoke-foreground-account-signin.png")),
});

const manifest = {
  generatedAt: startedAt,
  deviceName,
  udid,
  bundleId,
  settleMs,
  routeWarmupMs,
  captureWarmupMs,
  captureMask: "black",
  visualReviewRequired: true,
  captures,
};
const manifestPath = path.join(outputDir, "ios-deeplink-smoke-manifest.json");
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Captured ${captures.length} Misty iOS deep-link smoke screenshots:`);
for (const capture of captures) {
  console.log(`- ${capture.label}: ${capture.file} (${capture.expectedSurface})`);
}
console.log(`Manifest: ${path.relative(root, manifestPath)}`);
