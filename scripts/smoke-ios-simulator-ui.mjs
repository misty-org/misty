#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deviceName = process.env.TAURI_IOS_SIMULATOR_DEVICE ?? "iPad (A16)";
const bundleId = process.env.TAURI_IOS_BUNDLE_ID ?? "com.misty.mobile";
const outputDir = path.resolve(root, process.env.MISTY_IOS_UI_QA_DIR ?? "build/mobile-ui-qa");
const settleMs = Number(process.env.MISTY_IOS_UI_QA_SETTLE_MS ?? "30000");
const routeWarmupMs = Number(process.env.MISTY_IOS_ROUTE_WARMUP_MS ?? "1500");
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

function terminateApp(udid) {
  spawnSync("xcrun", ["simctl", "terminate", udid, bundleId], {
    cwd: root,
    encoding: "utf8",
    stdio: "ignore",
    env: process.env,
  });
  sleep(routeWarmupMs);
}

function launchApp(udid) {
  run("xcrun", ["simctl", "launch", udid, bundleId]);
  sleep(routeWarmupMs);
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

const startedAt = new Date().toISOString();
const captures = [];
const routes = [
  ["files", "misty://files", "Files", "50-smoke-ui-files.png"],
  ["remotes", "misty://providers", "Remotes", "51-smoke-ui-remotes.png"],
  ["transfers", "misty://transfers", "Transfers", "52-smoke-ui-transfers.png"],
  ["account", "misty://open/account", "Account overview", "53-smoke-ui-account.png"],
  ["account-signin", "misty://open/account/signin", "Account sign-in", "54-smoke-ui-account-signin.png"],
  ["account-register", "misty://open/account/register", "Account registration", "55-smoke-ui-account-register.png"],
  ["settings", "misty://open/account/settings", "Settings", "56-smoke-ui-settings.png"],
  ["spaces", "misty://open/spaces", "Spaces", "57-smoke-ui-spaces.png"],
  ["studio-agents", "misty://open/studio/agents", "Studio Agents", "58-smoke-ui-studio-agents.png"],
  ["studio-workflows", "misty://open/studio/workflows", "Studio Workflows", "59-smoke-ui-studio-workflows.png"],
];

for (const [label, url, expectedSurface, fileName] of routes) {
  terminateApp(udid);
  // Let the webview finish its launch transaction before delivering the route.
  // Cold deep-link behavior is exercised separately; this suite records stable UI.
  launchApp(udid);
  openUrl(udid, url);
  captures.push({
    label,
    url,
    expectedSurface,
    file: path.relative(root, screenshot(udid, fileName)),
  });
}

const manifest = {
  generatedAt: startedAt,
  deviceName,
  udid,
  bundleId,
  settleMs,
  routeWarmupMs,
  captureWarmupMs,
  captureMask: "black",
  coldStartEachRoute: true,
  launchBeforeRoute: true,
  visualReviewRequired: true,
  captures,
};
const manifestPath = path.join(outputDir, "ios-mobile-ui-smoke-manifest.json");
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Captured ${captures.length} Misty iPad UI screenshots:`);
for (const capture of captures) {
  console.log(`- ${capture.label}: ${capture.file} (${capture.expectedSurface})`);
}
console.log(`Manifest: ${path.relative(root, manifestPath)}`);
