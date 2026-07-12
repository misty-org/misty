#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const errors = [];
const warnings = [];
const passes = [];

const rel = (...parts) => path.join(root, ...parts);
const markPass = (message) => passes.push(message);
const markWarn = (message) => warnings.push(message);
const markError = (message) => errors.push(message);
const skipBuild = process.argv.includes("--skip-build");

if (!skipBuild) {
  try {
    execFileSync("npm", ["run", "build:mobile"], {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
    markPass("Built fresh mobile dist before release verification");
  } catch (error) {
    console.error("Could not build fresh mobile dist before release verification.");
    if (error instanceof Error) console.error(error.message);
    process.exit(1);
  }
} else {
  markPass("Using caller-provided fresh mobile dist for release verification");
}

function requireFile(relativePath) {
  const absolutePath = rel(relativePath);
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    markError(`Missing required file: ${relativePath}`);
    return false;
  }
  markPass(`Found ${relativePath}`);
  return true;
}

function requireMissing(relativePath, label) {
  const absolutePath = rel(relativePath);
  if (existsSync(absolutePath)) {
    markError(`Unexpected ${label}: ${relativePath}`);
    return;
  }
  markPass(`${label} is absent`);
}

function requireDir(relativePath) {
  const absolutePath = rel(relativePath);
  if (!existsSync(absolutePath) || !statSync(absolutePath).isDirectory()) {
    markError(`Missing required directory: ${relativePath}`);
    return false;
  }
  markPass(`Found ${relativePath}`);
  return true;
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(rel(relativePath), "utf8"));
}

function byteLength(value) {
  return Buffer.byteLength(String(value ?? ""), "utf8");
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function imageSize(relativePath) {
  const output = run("sips", ["-g", "pixelWidth", "-g", "pixelHeight", rel(relativePath)]);
  const width = output.match(/pixelWidth:\s*(\d+)/)?.[1];
  const height = output.match(/pixelHeight:\s*(\d+)/)?.[1];
  if (!width || !height) {
    throw new Error(`Could not read dimensions for ${relativePath}`);
  }
  return { width: Number(width), height: Number(height) };
}

function imageHasAlpha(relativePath) {
  const output = run("sips", ["-g", "hasAlpha", rel(relativePath)]);
  const value = output.match(/hasAlpha:\s*(\w+)/)?.[1];
  if (!value) {
    throw new Error(`Could not read alpha metadata for ${relativePath}`);
  }
  return value.toLowerCase() === "yes";
}

function requireImageSize(relativePath, width, height) {
  if (!requireFile(relativePath)) return;
  try {
    const actual = imageSize(relativePath);
    if (actual.width !== width || actual.height !== height) {
      markError(`Wrong dimensions for ${relativePath}: expected ${width}x${height}, got ${actual.width}x${actual.height}`);
      return;
    }
    markPass(`${relativePath} is ${width}x${height}`);
  } catch (error) {
    markError(`${relativePath} could not be inspected: ${error.message}`);
  }
}

function requireImageOpaque(relativePath) {
  if (!requireFile(relativePath)) return;
  try {
    if (imageHasAlpha(relativePath)) {
      markError(`${relativePath} has an alpha channel; iOS/App Store app icons must be flattened`);
      return;
    }
    markPass(`${relativePath} is opaque`);
  } catch (error) {
    markError(`${relativePath} alpha metadata could not be inspected: ${error.message}`);
  }
}

function requireScreenshotOpaque(relativePath) {
  if (!requireFile(relativePath)) return;
  try {
    if (imageHasAlpha(relativePath)) {
      markError(`${relativePath} has an alpha channel; simulator QA screenshots must use an opaque mask`);
      return;
    }
    markPass(`${relativePath} is opaque`);
  } catch (error) {
    markError(`${relativePath} alpha metadata could not be inspected: ${error.message}`);
  }
}

function requireText(relativePath, pattern, label) {
  if (!requireFile(relativePath)) return;
  const text = readFileSync(rel(relativePath), "utf8");
  if (!pattern.test(text)) {
    markError(`${relativePath} is missing ${label}`);
    return;
  }
  markPass(`${relativePath} includes ${label}`);
}

function requireTextIncludes(relativePath, expected, label) {
  if (!requireFile(relativePath)) return;
  const text = readFileSync(rel(relativePath), "utf8");
  if (!text.includes(String(expected))) {
    markError(`${relativePath} is missing ${label}`);
    return;
  }
  markPass(`${relativePath} includes ${label}`);
}

function requireJsonString(relativePath, value, label, options = {}) {
  const text = typeof value === "string" ? value : "";
  if (!text.trim()) {
    if (options.required === false) {
      markWarn(`${relativePath} ${label} is missing and must be supplied before submission`);
    } else {
      markError(`${relativePath} ${label} is missing`);
    }
    return;
  }
  if (options.maxChars != null && text.length > options.maxChars) {
    markError(`${relativePath} ${label} is too long: ${text.length} chars, max ${options.maxChars}`);
    return;
  }
  if (options.maxBytes != null && byteLength(text) > options.maxBytes) {
    markError(`${relativePath} ${label} is too long: ${byteLength(text)} bytes, max ${options.maxBytes}`);
    return;
  }
  if (options.url && !/^https:\/\//.test(text)) {
    markError(`${relativePath} ${label} must be an https URL`);
    return;
  }
  markPass(`${relativePath} ${label} is present${options.maxChars ? ` and <= ${options.maxChars} chars` : ""}${options.maxBytes ? ` and <= ${options.maxBytes} bytes` : ""}`);
}

function listFilesRecursive(relativePath) {
  const absolutePath = rel(relativePath);
  if (!existsSync(absolutePath)) return [];
  const entries = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absoluteEntry = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absoluteEntry);
      } else if (entry.isFile()) {
        entries.push(absoluteEntry);
      }
    }
  };
  walk(absolutePath);
  return entries;
}

function disallowedTermHits(text, label, terms, allowed = []) {
  const hits = [];
  const lowerText = text.toLowerCase();
  for (const term of terms) {
    const needle = term.toLowerCase();
    let index = lowerText.indexOf(needle);
    while (index !== -1) {
      const start = Math.max(0, index - 300);
      const end = Math.min(text.length, index + term.length + 300);
      const context = text.slice(start, end);
      const allowedHit = allowed.some((rule) => rule.test(`${label}\n${context}`));
      if (!allowedHit) {
        hits.push(`${label}: ${term}`);
        break;
      }
      index = lowerText.indexOf(needle, index + needle.length);
    }
  }
  return hits;
}

function scanFiles(relativePath, terms, label, allowed = []) {
  const files = listFilesRecursive(relativePath);
  if (files.length === 0) {
    markWarn(`Skipped ${label} scan because ${relativePath} does not exist or is empty.`);
    return;
  }
  const hits = [];
  for (const file of files) {
    const lowerPath = path.relative(root, file);
    const buffer = readFileSync(file);
    const text = buffer.toString("utf8");
    hits.push(...disallowedTermHits(text, lowerPath, terms, allowed));
  }
  if (hits.length > 0) {
    markError(`${label} scan found disallowed terms:\n  ${hits.slice(0, 25).join("\n  ")}`);
    return;
  }
  markPass(`${label} scan found no disallowed terms`);
}

function scanFile(relativePath, terms, label, allowed = []) {
  if (!requireFile(relativePath)) return;
  const text = readFileSync(rel(relativePath), "utf8");
  const hits = disallowedTermHits(text, relativePath, terms, allowed);
  if (hits.length > 0) {
    markError(`${label} scan found disallowed terms:\n  ${hits.join("\n  ")}`);
    return;
  }
  markPass(`${label} scan found no disallowed terms`);
}

function scanBinaryFile(relativePath, terms, label) {
  if (!requireFile(relativePath)) return;
  const hits = [];
  for (const term of terms) {
    try {
      const output = execFileSync("rg", ["-a", "-n", "-F", "-o", "-m", "1", term, rel(relativePath)], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      if (output) hits.push(`${relativePath}: ${term}`);
    } catch (error) {
      if (error?.status === 1) continue;
      markError(`${label} scan failed while searching for ${term}: ${error.message}`);
      return;
    }
  }
  if (hits.length > 0) {
    markError(`${label} scan found disallowed terms:\n  ${hits.join("\n  ")}`);
    return;
  }
  markPass(`${label} scan found no disallowed terms`);
}

function plistValue(relativePath, key) {
  return run("plutil", ["-extract", key, "raw", rel(relativePath)]);
}

function requirePlistValue(relativePath, key, expected) {
  if (!requireFile(relativePath)) return;
  try {
    const actual = plistValue(relativePath, key);
    if (actual !== expected) {
      markError(`${relativePath} ${key} expected "${expected}", got "${actual}"`);
      return;
    }
    markPass(`${relativePath} ${key} is ${expected}`);
  } catch (error) {
    markError(`Could not inspect ${relativePath} ${key}: ${error.message}`);
  }
}

function requirePlistMissing(relativePath, key, label) {
  if (!requireFile(relativePath)) return;
  try {
    const actual = plistValue(relativePath, key);
    markError(`${relativePath} unexpectedly includes ${label}: ${key}=${actual}`);
  } catch {
    markPass(`${relativePath} omits ${label}`);
  }
}

const packageJson = readJson("package.json");
const requiredScripts = [
  "build:mobile",
  "build:desktop",
  "screenshots:mobile:design",
  "screenshots:mobile:stage-butterkit",
  "smoke:ios:simulator:fresh-install",
  "smoke:ios:simulator:deeplinks",
  "smoke:ios:simulator:ui",
  "icons:ios:flatten",
  "tauri:ios:simulator:embedded",
  "tauri:ios:device:embedded",
  "tauri:ios:device:preflight",
  "tauri:ios:archive:app-store",
  "tauri:ios:archive:validate",
  "tauri:ios:archive:preflight",
  "package:mobile-app-store",
  "app-store:owner-fields:check",
  "app-store:owner-fields:strict",
  "app-store:submission-status",
  "app-store:submission-status:strict",
  "security:mobile:audit",
  "notarize:mac",
];

for (const scriptName of requiredScripts) {
  if (!packageJson.scripts?.[scriptName]) {
    markError(`package.json missing script "${scriptName}"`);
  } else {
    markPass(`package.json has script "${scriptName}"`);
  }
}

requireFile("scripts/run-ios-simulator.mjs");
requireFile("scripts/run-ios-device.mjs");
requireFile("scripts/build-ios-release.mjs");
requireFile("scripts/notarize-macos.mjs");
requireFile("scripts/design-mobile-app-store-screenshots.swift");
requireFile("scripts/stage-butterkit-mobile-screenshots.mjs");
requireFile("scripts/smoke-ios-simulator-fresh-install.mjs");
requireFile("scripts/smoke-ios-simulator-deeplinks.mjs");
requireFile("scripts/smoke-ios-simulator-ui.mjs");
requireFile("scripts/flatten-ios-app-icons.swift");
requireFile("scripts/package-mobile-app-store.mjs");
requireFile("scripts/validate-app-store-owner-fields.mjs");
requireFile("scripts/report-mobile-submission-status.mjs");
requireFile("scripts/audit-mobile-security.mjs");
requireFile("marketing/app-store-metadata/en-US/app-store-owner-fields.env.example");
requireFile("marketing/app-store-metadata/en-US/external-qa-evidence.example.json");
requireText("scripts/verify-mobile-release-readiness.mjs", /process\.argv\.includes\("--skip-build"\)/, "release verifier skip-build flag");
requireText("scripts/verify-mobile-release-readiness.mjs", /execFileSync\("npm", \["run", "build:mobile"\]/, "release verifier fresh mobile build before scans");
requireText("scripts/audit-mobile-security.mjs", /process\.argv\.includes\("--skip-build"\)/, "mobile security audit skip-build flag");
requireText("scripts/audit-mobile-security.mjs", /execFileSync\("npm", \["run", "build:mobile"\]/, "mobile security audit fresh mobile build before scans");
requireText("scripts/audit-mobile-security.mjs", /High-confidence secret formats only/, "mobile security audit conservative secret scan");
requireText("scripts/audit-mobile-security.mjs", /Production mobile bundle strings for debug panels, extension UI, and assistant placeholders/, "mobile security audit bundle scan");
requireText("scripts/audit-mobile-security.mjs", /desktop_notifications_enabled/, "mobile security audit desktop-named notification key scan");
requireText("scripts/audit-mobile-security.mjs", /Open With\.\.\./, "mobile security audit desktop-style Files action scan");
requireText("scripts/validate-app-store-owner-fields.mjs", /must be a production URL, not a placeholder or local URL/, "owner-field URL placeholder/local rejection");
requireText("scripts/report-mobile-submission-status.mjs", /readyForUpload/, "submission status ready-for-upload summary");
requireText("scripts/report-mobile-submission-status.mjs", /mobile-submission-status\.json/, "submission status JSON output");
requireText("scripts/report-mobile-submission-status.mjs", /testflight_live_provider_smoke/, "submission status records external QA blocker");
requireText("scripts/report-mobile-submission-status.mjs", /butterkit_no_watermark_export/, "submission status records paused ButterKit blocker");
requireText("scripts/report-mobile-submission-status.mjs", /externalQaRequiredChecks/, "submission status validates structured external QA evidence");
requireText("scripts/report-mobile-submission-status.mjs", /category: "local-evidence"/, "submission status promotes missing local evidence to blockers");
requireText("scripts/report-mobile-submission-status.mjs", /MISTY_IOS_EXTERNAL_QA_EVIDENCE_PATH/, "submission status supports an external QA evidence path override");
requireText("marketing/app-store-metadata/en-US/app-store-owner-fields.env.example", /MISTY_APP_REVIEW_DEMO_ACCOUNT_PASSWORD=/, "owner-field env template includes reviewer credential env vars");
requireText("scripts/run-ios-device.mjs", /APPLE_DEVELOPMENT_TEAM \?\? process\.env\.MISTY_IOS_DEVELOPMENT_TEAM/, "iOS device dev team env fallback");
requireText("scripts/run-ios-device.mjs", /--preflight-only/, "iOS device dev preflight-only flag");
requireText("scripts/run-ios-device.mjs", /Apple Development/, "iOS device dev signing identity preflight");
requireText("scripts/run-ios-device.mjs", /APPLE_DEVELOPMENT_TEAM:\s*developmentTeam[\s\S]{0,80}DEVELOPMENT_TEAM:\s*developmentTeam/, "iOS device dev team env propagation");
requireText("scripts/build-ios-release.mjs", /MISTY_IOS_SKIP_SIGNING_PREFLIGHT/, "iOS signing preflight override");
requireText("scripts/build-ios-release.mjs", /--preflight-only/, "iOS archive preflight-only flag");
requireText("scripts/build-ios-release.mjs", /Validated iOS archive signing preflight\. No archive was built because --preflight-only was used\./, "iOS archive preflight-only success message");
requireText("scripts/build-ios-release.mjs", /Apple Development[\s\S]{0,120}Apple Distribution/, "iOS signing identity preflight");
requireText("scripts/build-ios-release.mjs", /MISTY_IOS_BUILD_NUMBER[\s\S]{0,220}CFBundleVersion/, "iOS build number preflight");
requireText("scripts/build-ios-release.mjs", /VITE_MISTY_IOS_BUILD_NUMBER:\s*buildNumber/, "iOS archive propagates build number to mobile UI");
requireText("scripts/build-ios-release.mjs", /MISTY_IOS_DEVELOPMENT_TEAM \?\? process\.env\.APPLE_DEVELOPMENT_TEAM/, "iOS archive team env fallback");
requireText("scripts/build-ios-release.mjs", /MISTY_IOS_DEVELOPMENT_TEAM or APPLE_DEVELOPMENT_TEAM[\s\S]{0,360}10-character Apple Developer Team ID/, "iOS team id preflight");
requireText("scripts/build-ios-release.mjs", /APPLE_DEVELOPMENT_TEAM:\s*developmentTeam[\s\S]{0,80}DEVELOPMENT_TEAM:\s*developmentTeam/, "iOS team env propagation");
requireText("scripts/build-ios-release.mjs", /xcrun", \["--find", "xcodebuild"\]/, "Xcode toolchain preflight");
requireText("scripts/run-ios-simulator.mjs", /VITE_MISTY_IOS_BUILD_NUMBER:\s*buildNumber/, "iOS simulator propagates build number to mobile UI");
requireText("scripts/run-ios-device.mjs", /const buildNumber = process\.env\.MISTY_IOS_BUILD_NUMBER \?\? "1";/, "iOS device build number fallback");
requireText("scripts/run-ios-device.mjs", /VITE_MISTY_IOS_BUILD_NUMBER:\s*buildNumber/, "iOS device propagates build number to mobile UI");
requireText("scripts/package-mobile-app-store.mjs", /runDiagnosticLog\("tauri-ios-archive-preflight", "npm", \["run", "tauri:ios:archive:preflight"\]\)/, "package captures iOS archive preflight diagnostic");
requireText("scripts/package-mobile-app-store.mjs", /validation-logs\/tauri-ios-archive-preflight\.txt/, "package references iOS archive preflight log");
requireText("scripts/package-mobile-app-store.mjs", /runDiagnosticLog\("tauri-ios-device-preflight", "npm", \["run", "tauri:ios:device:preflight"\]\)/, "package captures iOS device preflight diagnostic");
requireText("scripts/package-mobile-app-store.mjs", /validation-logs\/tauri-ios-device-preflight\.txt/, "package references iOS device preflight log");
requireText("scripts/package-mobile-app-store.mjs", /runForLog\("cargo-check-tauri", "cargo", \["check", "--manifest-path", "src-tauri\/Cargo\.toml"\]\)/, "package captures baseline Tauri cargo check");
requireText("scripts/package-mobile-app-store.mjs", /runForLog\("cargo-check-tauri-ios-simulator", "cargo", \["check", "--manifest-path", "src-tauri\/Cargo\.toml", "--target", "aarch64-apple-ios-sim"\]\)/, "package captures iOS simulator Tauri cargo check");
requireText("scripts/package-mobile-app-store.mjs", /runForLog\("cargo-check-tauri-embedded-storage", "cargo", \["check", "--manifest-path", "src-tauri\/Cargo\.toml", "--features", "embedded-storage-go"\]\)/, "package captures embedded-storage Tauri cargo check");
requireText("scripts/package-mobile-app-store.mjs", /runForLog\("verify-mobile-release", "npm", \["run", "verify:mobile-release", "--", "--skip-build"\]\)/, "package verifies caller-provided fresh mobile build");
requireText("scripts/package-mobile-app-store.mjs", /runForLog\("mobile-security-audit", "npm", \["run", "security:mobile:audit", "--", "--skip-build"\]\)/, "package audits caller-provided fresh mobile build");
requireText("scripts/package-mobile-app-store.mjs", /runForLog\("app-store-submission-status", "npm", \["run", "app-store:submission-status"\]\)/, "package captures submission status report");
requireText("scripts/package-mobile-app-store.mjs", /validation-logs\/cargo-check-tauri\.txt/, "package references baseline Tauri cargo check log");
requireText("scripts/package-mobile-app-store.mjs", /validation-logs\/cargo-check-tauri-ios-simulator\.txt/, "package references iOS simulator Tauri cargo check log");
requireText("scripts/package-mobile-app-store.mjs", /validation-logs\/cargo-check-tauri-embedded-storage\.txt/, "package references embedded-storage Tauri cargo check log");
requireText("scripts/package-mobile-app-store.mjs", /copyFileOrDir\("docs\/mobile-qa-log\.md", "docs\/mobile-qa-log\.md"\)/, "package copies mobile QA log");
requireText("scripts/package-mobile-app-store.mjs", /"docs\/mobile-qa-log\.md"/, "package manifest references mobile QA log");
requireText("scripts/package-mobile-app-store.mjs", /copyFileOrDir\("build\/mobile-submission-status\.json", "submission-status\.json"\)/, "package copies submission status JSON");
requireText("scripts/package-mobile-app-store.mjs", /"submission-status\.md"/, "package manifest references submission status Markdown");
requireText("scripts/package-mobile-app-store.mjs", /function codeSignFacts\(appRelative\)/, "package inspects archive code signing");
requireText("scripts/package-mobile-app-store.mjs", /DTPlatformName/, "package distinguishes simulator and iphoneos archives");
requireText("scripts/package-mobile-app-store.mjs", /Apple\|iPhone\) Distribution/, "package requires Apple Distribution signing for uploadability");
requireText("scripts/package-mobile-app-store.mjs", /externalQaEvidencePackaged/, "package includes completed external QA evidence when present");
requireText("scripts/package-mobile-app-store.mjs", /external-qa-evidence\.example\.json/, "package manifest references external QA evidence template");
requireText("scripts/package-mobile-app-store.mjs", /copyFileOrDir\("scripts\/generate-app-store-screenshots\.swift", "release-scripts\/generate-app-store-screenshots\.swift"\)/, "package copies legacy screenshot generator for audited release provenance");
requireText("scripts/package-mobile-app-store.mjs", /"release-scripts\/generate-app-store-screenshots\.swift"/, "package manifest references legacy screenshot generator");
requireText("scripts/package-mobile-app-store.mjs", /copyFileOrDir\("scripts\/smoke-ios-simulator-fresh-install\.mjs", "release-scripts\/smoke-ios-simulator-fresh-install\.mjs"\)/, "package copies iOS simulator fresh-install smoke helper");
requireText("scripts/package-mobile-app-store.mjs", /"release-scripts\/smoke-ios-simulator-fresh-install\.mjs"/, "package manifest references iOS simulator fresh-install smoke helper");
requireText("scripts/package-mobile-app-store.mjs", /copyFileOrDir\("scripts\/smoke-ios-simulator-deeplinks\.mjs", "release-scripts\/smoke-ios-simulator-deeplinks\.mjs"\)/, "package copies iOS simulator deep-link smoke helper");
requireText("scripts/package-mobile-app-store.mjs", /"release-scripts\/smoke-ios-simulator-deeplinks\.mjs"/, "package manifest references iOS simulator deep-link smoke helper");
requireText("scripts/package-mobile-app-store.mjs", /copyFileOrDir\("scripts\/smoke-ios-simulator-ui\.mjs", "release-scripts\/smoke-ios-simulator-ui\.mjs"\)/, "package copies complete iOS simulator UI smoke helper");
requireText("scripts/package-mobile-app-store.mjs", /"release-scripts\/smoke-ios-simulator-ui\.mjs"/, "package manifest references complete iOS simulator UI smoke helper");
requireText("scripts/smoke-ios-simulator-fresh-install.mjs", /"simctl", "uninstall", udid, bundleId/, "iOS simulator fresh-install smoke resets app container");
requireText("scripts/smoke-ios-simulator-fresh-install.mjs", /44-smoke-fresh-install-first-launch\.png/, "iOS simulator fresh-install smoke captures first launch");
requireText("scripts/smoke-ios-simulator-fresh-install.mjs", /"screenshot", "--mask=black"/, "iOS simulator fresh-install smoke captures opaque screenshots");
requireText("scripts/smoke-ios-simulator-fresh-install.mjs", /function openUrl\(udid, url\) \{[\s\S]{0,180}"simctl", "openurl"[\s\S]{0,100}sleep\(settleMs\)/, "iOS simulator fresh-install smoke waits for route compositing before capture");
requireText("scripts/smoke-ios-simulator-fresh-install.mjs", /destructiveReset: true/, "iOS simulator fresh-install smoke manifest records destructive reset");
requireText("scripts/smoke-ios-simulator-fresh-install.mjs", /visualReviewRequired: true/, "iOS simulator fresh-install smoke manifest requires visual review");
requireText("scripts/smoke-ios-simulator-deeplinks.mjs", /misty:\/\/open\/account\/signin/, "iOS simulator deep-link smoke covers Account sign-in route");
requireText("scripts/smoke-ios-simulator-deeplinks.mjs", /misty:\/\/providers/, "iOS simulator deep-link smoke covers Remotes route");
requireText("scripts/smoke-ios-simulator-deeplinks.mjs", /"screenshot", "--mask=black"/, "iOS simulator deep-link smoke captures opaque screenshots");
requireText("scripts/smoke-ios-simulator-deeplinks.mjs", /function openUrl\(udid, url\) \{[\s\S]{0,180}"simctl", "openurl"[\s\S]{0,100}sleep\(settleMs\)/, "iOS simulator deep-link smoke waits for route compositing before capture");
requireText("scripts/smoke-ios-simulator-deeplinks.mjs", /visualReviewRequired: true/, "iOS simulator deep-link smoke manifest requires visual review");
requireText("scripts/smoke-ios-simulator-ui.mjs", /50-smoke-ui-files\.png[\s\S]{0,800}56-smoke-ui-settings\.png/, "complete iOS simulator UI smoke covers every shipped mobile surface");
requireText("scripts/smoke-ios-simulator-ui.mjs", /"screenshot", "--mask=black"/, "complete iOS simulator UI smoke captures opaque screenshots");
requireText("scripts/smoke-ios-simulator-ui.mjs", /function openUrl\(udid, url\) \{[\s\S]{0,180}"simctl", "openurl"[\s\S]{0,100}sleep\(settleMs\)/, "complete iOS simulator UI smoke waits for route compositing before capture");
requireText("scripts/smoke-ios-simulator-ui.mjs", /coldStartEachRoute: true/, "complete iOS simulator UI smoke cold-starts every captured route");
requireText("scripts/smoke-ios-simulator-ui.mjs", /ios-mobile-ui-smoke-manifest\.json/, "complete iOS simulator UI smoke writes a manifest");
requireText("scripts/package-mobile-app-store.mjs", /const uiQaCaptures = \[[\s\S]{0,220}44-smoke-fresh-install-first-launch\.png/, "package declares current mobile UI QA captures");
requireText("scripts/package-mobile-app-store.mjs", /copyFileOrDir\(`build\/mobile-ui-qa\/\$\{file\}`, `qa\/mobile-ui-qa\/\$\{file\}`\)/, "package copies mobile UI QA captures");
requireText("scripts/package-mobile-app-store.mjs", /qaEvidence: uiQaCaptures\.map/, "package manifest references mobile UI QA captures");
requireText("src/routing/deepLinks.ts", /window\.addEventListener\("focus", handleCurrentUrls\)/, "deep link handler rechecks current URLs on focus");
requireText("src/routing/deepLinks.ts", /document\.addEventListener\("visibilitychange", handleVisibleCurrentUrls\)/, "deep link handler rechecks current URLs on visibility return");
requireText("src/routing/deepLinks.ts", /formFactor === "mobile"[\s\S]{0,180}window\.setInterval\(\(\) => \{[\s\S]{0,180}handleCurrentUrls\(\)/, "mobile deep link handler polls current URLs while visible");
requireText("src/routing/deepLinks.ts", /if \(currentUrlPoll !== null\) window\.clearInterval\(currentUrlPoll\);/, "mobile deep link current URL poll cleans up");
requireText("src/routing/deepLinks.ts", /onOpenUrl\(\(urls\) => handleUrls\(urls, "event"\)\)/, "deep link handler still listens for running-app URL events");

const rawCaptures = [
  "01-files.png",
  "02-remotes.png",
  "03-transfers.png",
  "04-settings-account.png",
  "05-account-setup.png",
];

for (const file of rawCaptures) {
  requireImageSize(`marketing/app-store-screenshots/mobile/raw/accepted/${file}`, 1206, 2622);
  requireImageSize(`marketing/app-store-screenshots/mobile/final/iphone-6-9/en-US/designed-fallback/${file}`, 1320, 2868);
  requireImageSize(`marketing/app-store-screenshots/mobile/final/iphone-6-9/en-US/fallback-direct-resize/${file}`, 1320, 2868);
  requireImageSize(`marketing/app-store-screenshots/mobile/final/iphone-6-5/en-US/designed-fallback/${file}`, 1242, 2688);
  requireImageSize(`marketing/app-store-screenshots/mobile/final/iphone-6-5/en-US/fallback-direct-resize/${file}`, 1242, 2688);
}

for (const file of [
  "44-smoke-fresh-install-first-launch.png",
  "45-smoke-fresh-install-providers.png",
  "46-smoke-fresh-install-account-signin.png",
  "50-smoke-ui-files.png",
  "51-smoke-ui-remotes.png",
  "52-smoke-ui-transfers.png",
  "53-smoke-ui-account.png",
  "54-smoke-ui-account-signin.png",
  "55-smoke-ui-account-register.png",
  "56-smoke-ui-settings.png",
  "40-smoke-cold-providers.png",
  "41-smoke-foreground-files.png",
  "42-smoke-foreground-providers.png",
  "43-smoke-foreground-account-signin.png",
]) {
  requireImageSize(`build/mobile-ui-qa/${file}`, 1206, 2622);
  requireScreenshotOpaque(`build/mobile-ui-qa/${file}`);
}

const appIconCatalog = "src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/Contents.json";
requireFile(appIconCatalog);
const appIcons = readJson(appIconCatalog).images ?? [];
const requiredIconSlots = [
  ["iphone", "20x20", "2x"],
  ["iphone", "20x20", "3x"],
  ["iphone", "29x29", "2x"],
  ["iphone", "29x29", "3x"],
  ["iphone", "40x40", "2x"],
  ["iphone", "40x40", "3x"],
  ["iphone", "60x60", "2x"],
  ["iphone", "60x60", "3x"],
  ["ipad", "20x20", "1x"],
  ["ipad", "20x20", "2x"],
  ["ipad", "29x29", "1x"],
  ["ipad", "29x29", "2x"],
  ["ipad", "40x40", "1x"],
  ["ipad", "40x40", "2x"],
  ["ipad", "76x76", "1x"],
  ["ipad", "76x76", "2x"],
  ["ipad", "83.5x83.5", "2x"],
  ["ios-marketing", "1024x1024", "1x"],
];
for (const [idiom, size, scale] of requiredIconSlots) {
  const entry = appIcons.find((icon) => icon.idiom === idiom && icon.size === size && icon.scale === scale);
  if (!entry?.filename) {
    markError(`App icon catalog missing ${idiom} ${size} ${scale}`);
    continue;
  }
  const [logicalWidth, logicalHeight] = size.split("x").map(Number);
  const scaleFactor = Number(scale.replace("x", ""));
  const width = Math.round(logicalWidth * scaleFactor);
  const height = Math.round(logicalHeight * scaleFactor);
  const iconPath = `src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/${entry.filename}`;
  requireImageSize(iconPath, width, height);
  requireImageOpaque(iconPath);
}

requireFile("marketing/app-store-screenshots/mobile/manifest.md");
requireText("marketing/app-store-screenshots/mobile/manifest.md", /1320 x 2868/, "6.9-inch screenshot dimensions");
requireText("marketing/app-store-screenshots/mobile/manifest.md", /1242 x 2688/, "6.5-inch screenshot dimensions");
requireText("marketing/app-store-screenshots/mobile/manifest.md", /Butterkit/i, "Butterkit status and handoff");
const screenshotCopyGuidanceAllowList = [
  /marketing\/app-store-screenshots\/mobile\/manifest\.md[\s\S]{0,420}Do not mention prices, subscriptions, external purchase paths, upgrades, or unsupported automation\./,
];
for (const screenshotTextFile of [
  "scripts/design-mobile-app-store-screenshots.swift",
  "scripts/generate-app-store-screenshots.swift",
  "marketing/app-store-screenshots/mobile/manifest.md",
  "marketing/app-store-screenshots/mobile/final/iphone-6-9/en-US/README.md",
  "marketing/app-store-screenshots/mobile/final/iphone-6-5/en-US/README.md",
]) {
  scanFile(screenshotTextFile, [
    "license",
    "licensed",
    "pricing",
    "payment",
    "purchase",
    "upgrade",
    "external payment",
    "website purchase",
    "subscribe on website",
  ], "screenshot text App Review-safe copy", screenshotCopyGuidanceAllowList);
}
requireFile("marketing/app-store-screenshots/mobile/final/iphone-6-9/en-US/README.md");
requireText(
  "marketing/app-store-screenshots/mobile/final/iphone-6-9/en-US/README.md",
  /Use `designed-fallback\/` as the current submission-safe screenshot set\./,
  "submission-safe screenshot folder guidance",
);
requireFile("marketing/app-store-screenshots/mobile/final/iphone-6-5/en-US/README.md");
requireText(
  "marketing/app-store-screenshots/mobile/final/iphone-6-5/en-US/README.md",
  /optional 1242 x 2688 screenshots/,
  "optional 6.5-inch screenshot guidance",
);

for (const file of [
  "marketing/app-store-metadata/en-US/app-info.md",
  "marketing/app-store-metadata/en-US/app-store-connect.json",
  "marketing/app-store-metadata/en-US/review-notes.md",
  "marketing/app-store-metadata/en-US/review-notes.txt",
  "marketing/app-store-metadata/en-US/privacy-labels-draft.md",
  "marketing/app-store-metadata/en-US/publish-checklist.md",
  "docs/mobile-app-store-readiness.md",
  "docs/mobile-app-store-completion-audit.md",
  "docs/mobile-qa-log.md",
]) {
  requireFile(file);
}
requireText("docs/mobile-qa-log.md", /iPhone 17[\s\S]{0,120}iOS 26\.5/, "mobile QA log records simulator device and OS");
requireText("docs/mobile-qa-log.md", /Sign-in with reviewer account[\s\S]{0,180}Not run[\s\S]{0,180}reviewer demo credentials/, "mobile QA log records reviewer sign-in blocker");
requireText("docs/mobile-qa-log.md", /Real device debug run[\s\S]{0,180}Blocked[\s\S]{0,180}Apple Development/, "mobile QA log records real-device signing blocker");
requireText("docs/mobile-qa-log.md", /Watermark-free App Store screenshots[\s\S]{0,180}Paused pending UI approval[\s\S]{0,260}designed-fallback/, "mobile QA log records screenshot regeneration pause");

const metadata = readJson("marketing/app-store-metadata/en-US/app-store-connect.json");
const appStoreCategories = new Set([
  "BOOKS",
  "BUSINESS",
  "DEVELOPER_TOOLS",
  "EDUCATION",
  "ENTERTAINMENT",
  "FINANCE",
  "FOOD_AND_DRINK",
  "GAMES",
  "GRAPHICS_AND_DESIGN",
  "HEALTH_AND_FITNESS",
  "LIFESTYLE",
  "MAGAZINES_AND_NEWSPAPERS",
  "MEDICAL",
  "MUSIC",
  "NAVIGATION",
  "NEWS",
  "PHOTO_AND_VIDEO",
  "PRODUCTIVITY",
  "REFERENCE",
  "SHOPPING",
  "SOCIAL_NETWORKING",
  "SPORTS",
  "STICKERS",
  "TRAVEL",
  "UTILITIES",
  "WEATHER",
]);
if (metadata.bundleId !== "com.misty.mobile") {
  markError(`marketing/app-store-metadata/en-US/app-store-connect.json bundleId expected com.misty.mobile, got ${metadata.bundleId}`);
} else {
  markPass("app-store-connect.json bundleId is com.misty.mobile");
}
if (metadata.platform !== "IOS") {
  markError(`marketing/app-store-metadata/en-US/app-store-connect.json platform expected IOS, got ${metadata.platform}`);
} else {
  markPass("app-store-connect.json platform is IOS");
}
if (metadata.locale !== "en-US") {
  markError(`marketing/app-store-metadata/en-US/app-store-connect.json locale expected en-US, got ${metadata.locale}`);
} else {
  markPass("app-store-connect.json locale is en-US");
}
if (!/^\d+\.\d+\.\d+$/.test(String(metadata.versionString ?? ""))) {
  markError(`marketing/app-store-metadata/en-US/app-store-connect.json versionString expected semantic version, got ${metadata.versionString}`);
} else {
  markPass("app-store-connect.json versionString is semantic");
}
if (!/^\d+(?:\.\d+){0,2}$/.test(String(metadata.buildNumber ?? ""))) {
  markError(`marketing/app-store-metadata/en-US/app-store-connect.json buildNumber expected App Store-valid numeric value, got ${metadata.buildNumber}`);
} else {
  markPass("app-store-connect.json buildNumber is App Store-valid numeric value");
}
if (!appStoreCategories.has(metadata.appInfo?.primaryCategory)) {
  markError(`app-store-connect.json primary category is invalid: ${metadata.appInfo?.primaryCategory}`);
} else {
  markPass("app-store-connect.json primary category is valid");
}
if (metadata.appInfo?.secondaryCategory && !appStoreCategories.has(metadata.appInfo.secondaryCategory)) {
  markError(`app-store-connect.json secondary category is invalid: ${metadata.appInfo.secondaryCategory}`);
} else {
  markPass("app-store-connect.json secondary category is valid or empty");
}
if (metadata.appInfo?.secondaryCategory && metadata.appInfo.secondaryCategory === metadata.appInfo.primaryCategory) {
  markError("app-store-connect.json secondary category must differ from primary category");
} else {
  markPass("app-store-connect.json secondary category differs from primary category or is empty");
}
requireJsonString("marketing/app-store-metadata/en-US/app-store-connect.json", metadata.appInfo?.name, "app name", { maxChars: 30 });
requireJsonString("marketing/app-store-metadata/en-US/app-store-connect.json", metadata.appInfo?.subtitle, "subtitle", { maxChars: 30 });
requireJsonString("marketing/app-store-metadata/en-US/app-store-connect.json", metadata.versionInfo?.promotionalText, "promotional text", { maxChars: 170 });
requireJsonString("marketing/app-store-metadata/en-US/app-store-connect.json", metadata.versionInfo?.description, "description", { maxChars: 4000 });
requireJsonString("marketing/app-store-metadata/en-US/app-store-connect.json", metadata.versionInfo?.keywords, "keywords", { maxBytes: 100 });
requireJsonString("marketing/app-store-metadata/en-US/app-store-connect.json", metadata.reviewInfo?.notes, "review notes", { maxChars: 4000 });
requireJsonString("marketing/app-store-metadata/en-US/app-store-connect.json", metadata.versionInfo?.supportUrl, "support URL", { required: false, url: true });
if (typeof metadata.versionInfo?.marketingUrl === "string" && metadata.versionInfo.marketingUrl.trim()) {
  requireJsonString("marketing/app-store-metadata/en-US/app-store-connect.json", metadata.versionInfo.marketingUrl, "marketing URL", { url: true });
} else {
  markPass("marketing URL is empty optional metadata");
}
requireJsonString("marketing/app-store-metadata/en-US/app-store-connect.json", metadata.appInfo?.privacyPolicyUrl, "privacy policy URL", { required: false, url: true });
requireJsonString("marketing/app-store-metadata/en-US/app-store-connect.json", metadata.reviewInfo?.contactFirstName, "review contact first name", { required: false });
requireJsonString("marketing/app-store-metadata/en-US/app-store-connect.json", metadata.reviewInfo?.contactLastName, "review contact last name", { required: false });
requireJsonString("marketing/app-store-metadata/en-US/app-store-connect.json", metadata.reviewInfo?.contactPhone, "review contact phone", { required: false });
requireJsonString("marketing/app-store-metadata/en-US/app-store-connect.json", metadata.reviewInfo?.contactEmail, "review contact email", { required: false });
requireJsonString("marketing/app-store-metadata/en-US/app-store-connect.json", metadata.reviewInfo?.demoAccountName, "demo account name", { required: false });
requireJsonString("marketing/app-store-metadata/en-US/app-store-connect.json", metadata.reviewInfo?.demoAccountPassword, "demo account password", { required: false });
requireTextIncludes("marketing/app-store-metadata/en-US/app-info.md", metadata.appInfo?.name, "metadata app name from app-store-connect.json");
requireTextIncludes("marketing/app-store-metadata/en-US/app-info.md", metadata.appInfo?.subtitle, "metadata subtitle from app-store-connect.json");
requireTextIncludes("marketing/app-store-metadata/en-US/app-info.md", metadata.versionInfo?.promotionalText, "metadata promotional text from app-store-connect.json");
requireTextIncludes("marketing/app-store-metadata/en-US/app-info.md", metadata.versionInfo?.description, "metadata full description from app-store-connect.json");
requireTextIncludes("marketing/app-store-metadata/en-US/app-info.md", metadata.versionInfo?.keywords, "metadata keywords from app-store-connect.json");
requireTextIncludes("marketing/app-store-metadata/en-US/review-notes.md", "Misty is a file browsing and storage companion/client for iPhone.", "review notes product summary");
requireTextIncludes("marketing/app-store-metadata/en-US/review-notes.md", "The iOS app does not include in-app purchases, external purchase prompts, pricing, subscription calls to action, or extension/plugin functionality.", "review notes App Review-safe commerce/plugin statement");
requireTextIncludes("marketing/app-store-metadata/en-US/review-notes.txt", "Reviewer test path:", "paste-ready review notes reviewer test path");
requireTextIncludes("marketing/app-store-metadata/en-US/review-notes.txt", "Missing before submission:", "paste-ready review notes owner-field reminder");

const iosConfig = readJson("src-tauri/tauri.ios.conf.json");
if (iosConfig.identifier !== "com.misty.mobile") {
  markError(`src-tauri/tauri.ios.conf.json identifier expected com.misty.mobile, got ${iosConfig.identifier}`);
} else {
  markPass("src-tauri/tauri.ios.conf.json identifier is com.misty.mobile");
}
if (iosConfig.productName !== "Misty") {
  markError(`src-tauri/tauri.ios.conf.json productName expected Misty, got ${iosConfig.productName}`);
} else {
  markPass("src-tauri/tauri.ios.conf.json productName is Misty");
}

requirePlistValue("src-tauri/gen/apple/misty-desktop_iOS/Info.plist", "CFBundleVersion", "1");
requirePlistValue("src-tauri/gen/apple/misty-desktop_iOS/Info.plist", "CFBundleURLTypes.0.CFBundleURLSchemes.0", "misty");
requirePlistValue("src-tauri/gen/apple/misty-desktop_iOS/Info.plist", "ITSAppUsesNonExemptEncryption", "false");
requirePlistValue("src-tauri/gen/apple/misty-desktop_iOS/Info.plist", "NSAppTransportSecurity.NSAllowsLocalNetworking", "true");
requirePlistValue("src-tauri/gen/apple/misty-desktop_iOS/Info.plist", "UISupportedInterfaceOrientations.0", "UIInterfaceOrientationPortrait");
requirePlistMissing("src-tauri/gen/apple/misty-desktop_iOS/Info.plist", "UISupportedInterfaceOrientations.1", "unverified iPhone landscape orientation");
requirePlistMissing("src-tauri/gen/apple/misty-desktop_iOS/Info.plist", "UISupportedInterfaceOrientations~ipad", "iPad-specific orientation metadata");
requireText("src-tauri/gen/apple/project.yml", /PRODUCT_BUNDLE_IDENTIFIER:\s*com\.misty\.mobile/, "iOS product bundle identifier");
requireText("src-tauri/gen/apple/project.yml", /deploymentTarget:\s*\n\s*iOS:\s*15\.0/, "iOS deployment target");
requireText("src-tauri/gen/apple/project.yml", /TARGETED_DEVICE_FAMILY:\s*1\b/, "iPhone-only target family");
requireText("src-tauri/gen/apple/project.yml", /UISupportedInterfaceOrientations:\s*\n\s*-\s*UIInterfaceOrientationPortrait\s*\n\s*CFBundleShortVersionString:/, "iPhone portrait-only orientation without iPad orientation block");
requireText("src-tauri/gen/apple/project.yml", /ITSAppUsesNonExemptEncryption:\s*false/, "iOS export compliance flag");
requireText("src-tauri/gen/apple/project.yml", /NSLocalNetworkUsageDescription:\s*Misty uses local secure runtime services on this device to browse and transfer files\./, "iOS local network purpose in XcodeGen config");
requireText("src-tauri/gen/apple/misty-desktop.xcodeproj/project.pbxproj", /PRODUCT_BUNDLE_IDENTIFIER = com\.misty\.mobile;/, "generated Xcode bundle identifier");
requireText("src-tauri/gen/apple/misty-desktop.xcodeproj/project.pbxproj", /IPHONEOS_DEPLOYMENT_TARGET = 15\.0;/, "generated Xcode deployment target");
requireText("src-tauri/gen/apple/misty-desktop.xcodeproj/project.pbxproj", /TARGETED_DEVICE_FAMILY = 1;/, "generated Xcode iPhone-only target family");
requireText("src-tauri/gen/apple/misty-desktop.xcodeproj/project.pbxproj", /PrivacyInfo\.xcprivacy in Resources/, "generated Xcode privacy manifest resource");
requireText(
  "src-tauri/Info.ios.plist",
  /Misty uses local secure runtime services on this device to browse and transfer files\./,
  "App Review-safe local network purpose string",
);
requirePlistValue("src-tauri/Info.ios.plist", "ITSAppUsesNonExemptEncryption", "false");
requireFile("src-tauri/gen/apple/misty-desktop_iOS/PrivacyInfo.xcprivacy");
requirePlistValue("src-tauri/gen/apple/misty-desktop_iOS/PrivacyInfo.xcprivacy", "NSPrivacyTracking", "false");
requirePlistMissing("src-tauri/gen/apple/misty-desktop_iOS/PrivacyInfo.xcprivacy", "NSPrivacyTrackingDomains.0", "privacy manifest tracking domains");
for (const [token, label] of [
  ["NSPrivacyAccessedAPICategoryFileTimestamp", "privacy manifest file timestamp API reason"],
  ["NSPrivacyAccessedAPICategoryDiskSpace", "privacy manifest disk space API reason"],
  ["NSPrivacyAccessedAPICategorySystemBootTime", "privacy manifest system boot time API reason"],
  ["NSPrivacyAccessedAPICategoryUserDefaults", "privacy manifest user defaults API reason"],
  ["C617.1", "privacy manifest file timestamp reason code"],
  ["E174.1", "privacy manifest disk space reason code"],
  ["35F9.1", "privacy manifest system boot time reason code"],
  ["CA92.1", "privacy manifest user defaults reason code"],
  ["NSPrivacyCollectedDataTypeEmailAddress", "privacy manifest account email data type"],
  ["NSPrivacyCollectedDataTypeName", "privacy manifest name data type"],
  ["NSPrivacyCollectedDataTypeUserID", "privacy manifest user id data type"],
  ["NSPrivacyCollectedDataTypeOtherUserContent", "privacy manifest user content data type"],
  ["NSPrivacyCollectedDataTypeCrashData", "privacy manifest crash data type"],
  ["NSPrivacyCollectedDataTypePerformanceData", "privacy manifest performance data type"],
]) {
  requireText("src-tauri/gen/apple/misty-desktop_iOS/PrivacyInfo.xcprivacy", new RegExp(token.replace(".", "\\.")), label);
}
for (const [pattern, label] of [
  [/NSPrivacyTracking=false/, "privacy-label draft tracking disabled"],
  [/NSPrivacyTrackingDomains=\[\]/, "privacy-label draft no tracking domains"],
  [/Email address, linked to the user, App Functionality\./, "privacy-label draft email data"],
  [/Name, linked to the user, App Functionality\./, "privacy-label draft name data"],
  [/User ID, linked to the user, App Functionality\./, "privacy-label draft user id data"],
  [/Other user content, linked to the user, App Functionality\./, "privacy-label draft user content data"],
  [/Crash data, not linked, App Functionality\./, "privacy-label draft crash data"],
  [/Performance data, not linked, App Functionality\./, "privacy-label draft performance data"],
  [/File timestamps: `C617\.1`/, "privacy-label draft file timestamp reason"],
  [/Disk space: `E174\.1`/, "privacy-label draft disk space reason"],
  [/System boot time: `35F9\.1`/, "privacy-label draft system boot time reason"],
  [/User defaults: `CA92\.1`/, "privacy-label draft user defaults reason"],
]) {
  requireText("marketing/app-store-metadata/en-US/privacy-labels-draft.md", pattern, label);
}
requireText("src/shared/components/RenderErrorBoundary.tsx", /if \(import\.meta\.env\.DEV\) \{\s*console\.error\("Workspace render failed"/, "production-gated render error logging");
scanFile("src-tauri/src/services/transfers.rs", [
  "SQLite transfer store recovery failed: {error}",
], "native transfer recovery sensitive log");
scanFile("src/pages/Files/mobile/index.tsx", [
  "Mika",
  "MistyAI",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "coming soon",
  "Match desktop hidden file browsing",
  "Create a pair from desktop compare",
  "Open With...",
  "Choose Application",
  "Upload Folder",
], "mobile Files assistant/dead-feature source");
requireFile("src/pages/Files/mobile/MobileFirstLaunchWelcome.tsx");
requireText("src/pages/Files/mobile/index.tsx", /<MobileFirstLaunchWelcome \/>/, "mobile Files includes first-launch welcome");
requireText("src/pages/Files/mobile/MobileFirstLaunchWelcome.tsx", /misty\.mobile\.welcome\.v1/, "mobile first-launch welcome uses versioned local completion state");
requireText("src/pages/Files/mobile/MobileFirstLaunchWelcome.tsx", /Browse this device/, "mobile first-launch welcome preserves account-free local browsing");
requireText("src/pages/Files/mobile/MobileFirstLaunchWelcome.tsx", /navigate\("\/account\/signin"\)/, "mobile first-launch welcome routes to in-app sign-in");
scanFile("src/pages/Files/mobile/MobileFirstLaunchWelcome.tsx", [
  "subscription",
  "pricing",
  "upgrade",
  "purchase",
  "website",
], "mobile first-launch welcome App Review-sensitive purchase language");
requireText("src/pages/Files/mobile/index.tsx", /const mobileActionDebugEnabled = import\.meta\.env\.DEV;/, "development-only mobile Files action debug gate");
requireText("src/pages/Files/mobile/index.tsx", /mobileActionDebugEnabled && actionDebug/, "development-only mobile Files action debug render guard");
requireText("src/pages/Files/mobile/index.tsx", /const filesSortButtonClass = "grid h-11 w-11/, "mobile Files toolbar uses 44-point icon targets");
requireText("src/pages/Files/mobile/index.tsx", /const fileSelectButtonClass = "grid h-11 w-11/, "mobile Files selection controls use 44-point targets");
requireText("src/pages/Providers/mobile/index.tsx", /const mobileProviderAuthDebugEnabled = import\.meta\.env\.DEV;/, "development-only mobile provider auth debug gate");
requireText("src/pages/Providers/mobile/index.tsx", /mobileProviderAuthDebugEnabled \? \(/, "development-only mobile provider auth debug render guard");
requireText("src/pages/Providers/mobile/index.tsx", /const iconButtonClass = "relative grid h-11 w-11/, "mobile Remotes icon controls use 44-point targets");
requireText("src/pages/Providers/mobile/index.tsx", /const remoteActionClass = "inline-flex min-h-11/, "mobile Remotes row actions use 44-point targets");
requireText("src/pages/Providers/mobile/index.tsx", /function MobileProviderDiscardSheet/, "mobile Remotes has a native unsaved-edit confirmation sheet");
scanFile("src/pages/Providers/mobile/index.tsx", [
  "window.confirm",
], "mobile Remotes browser confirmation fallback");
scanFile("src/pages/Settings/mobile/index.tsx", [
  "v0.1.0-beta",
  "Mobile shell",
], "mobile Settings release-safe About copy");
requireText("src/pages/Settings/mobile/index.tsx", /const mobileBuildNumber = import\.meta\.env\.VITE_MISTY_IOS_BUILD_NUMBER \|\| "1";/, "mobile Settings reads release build number env");
requireText("src/pages/Settings/mobile/index.tsx", /<MobileValueRow label="Build" value=\{mobileBuildNumber\} muted \/>/, "mobile Settings displays release build number");
requireText("src/pages/Settings/mobile/index.tsx", /const mobileDeviceNotificationsKey = "device_notifications_enabled";/, "mobile Settings uses device notification preference key");
requireText("src/pages/Settings/mobile/index.tsx", /role="switch"[\s\S]{0,100}aria-label=\{props\.label\}[\s\S]{0,120}className="grid h-11 w-12/, "mobile Settings switches expose labeled 44-point controls");
scanFile("src/pages/Settings/mobile/index.tsx", [
  "desktop_notifications_enabled",
], "mobile Settings source desktop-named notification key");
requireText("src/pages/Account/mobile/index.tsx", /const interactive = typeof props\.onClick === "function";/, "mobile Account rows distinguish static facts from tappable actions");
requireText("src/pages/Account/mobile/index.tsx", /return interactive \? \(\s*<button type="button"/, "mobile Account rows only render buttons when interactive");
requireText("src/pages/Account/mobile/index.tsx", /label="Notifications" detail="Managed in Settings" onClick=\{props\.onSettings\}/, "mobile Account notification row navigates instead of dead-tapping");
requireText("src/pages/Account/mobile/index.tsx", /label="Privacy" detail="Managed in Settings" onClick=\{props\.onSettings\}/, "mobile Account privacy row navigates instead of dead-tapping");
requireText("src/pages/Account/mobile/index.tsx", /useEffect\(\(\) => \{\s*setPassword\(""\);\s*\}, \[mode\]\);/, "mobile Account clears password state when switching modes");
requireText("src/pages/Account/mobile/index.tsx", /accountSignIn\(email, password\);[\s\S]{0,220}saveAuthenticatedUser\(authUser, license\);\s*setPassword\(""\);[\s\S]{0,180}navigate\("\/account", \{ replace: true \}\);/, "mobile Account clears password state after sign-in success");
requireText("src/pages/Account/mobile/index.tsx", /accountRegister\(name, email, password\);[\s\S]{0,220}saveAuthenticatedUser\(authUser, license\);\s*setPassword\(""\);[\s\S]{0,180}navigate\("\/account", \{ replace: true \}\);/, "mobile Account clears password state after register success");
requireText("src/pages/Account/mobile/index.tsx", /await signOut\(\);\s*setPassword\(""\);/, "mobile Account clears password state after sign-out");
scanFile("src/pages/Account/mobile/index.tsx", [
  "clientDebugPanelEnabled",
  "readClientDebugEvents",
  "Clear debug events",
  "Misty server API",
  "misty-client-debug",
], "mobile Account debug panel source");
requireText("src/auth/AuthContext.tsx", /const shouldPersistAuthUser = !isNativeMobileBuild;/, "mobile AuthProvider disables persisted profile storage");
requireText("src/auth/AuthContext.tsx", /shouldPersistAuthUser \? readStoredUser\(\) : null/, "mobile AuthProvider does not initialize from persisted profile storage");
requireText("src/auth/AuthContext.tsx", /if \(shouldPersistAuthUser\) \{\s*writeStoredUser\(user\);\s*\} else \{\s*clearStoredUser\(\);/, "mobile AuthProvider clears persisted profile storage instead of writing it");
requireText("src/stores/useSetupStore.ts", /accountFetchMe,[\s\S]{0,80}type AccountMeResponse,[\s\S]{0,80}from "\.\.\/pages\/Account\/shared\/api"/, "setup store uses shared Account API instead of desktop page API");
scanFile("src/stores/useSetupStore.ts", [
  "../pages/Account/desktop/api",
  "Tauri desktop runtime",
  "desktop runtime",
  "Tauri app",
], "setup store mobile-safe runtime copy/imports");
requireText("src/stores/useUserStore.ts", /import type \{ AccountMeResponse \} from "\.\.\/pages\/Account\/shared\/api";/, "user store uses shared Account API type instead of desktop page API");
scanFile("src/stores/useUserStore.ts", [
  "../pages/Account/desktop/api",
], "user store mobile-safe account type import");
requireText("src/pages/Transfers/mobile/index.tsx", /useNavigate/, "mobile Transfers empty state can route to next steps");
requireText("src/pages/Transfers/mobile/index.tsx", /> Browse files\s*<\/button>/, "mobile Transfers empty state offers Files next step");
requireText("src/pages/Transfers/mobile/index.tsx", /> Connect remotes\s*<\/button>/, "mobile Transfers empty state offers Remotes next step");
requireText("src/pages/Transfers/mobile/index.tsx", /navigate\("\/files"\)/, "mobile Transfers empty state routes to Files");
requireText("src/pages/Transfers/mobile/index.tsx", /navigate\("\/providers"\)/, "mobile Transfers empty state routes to Remotes");
requireText("src/pages/Transfers/mobile/index.tsx", /const filterButtonClass = "min-h-11/, "mobile Transfers filters use 44-point targets");
requireText("src/layouts/MobileLayout.tsx", /const mobileIconButtonClass = "relative grid h-11 w-11/, "mobile shell activity control uses a 44-point target");
requireText("src/layouts/MobileLayout.tsx", /const mobileShellBaseClass = "isolate grid/, "mobile shell isolates route stacking");
requireText("src/layouts/MobileLayout.tsx", /const mobileTopbarClass = "relative z-\[60\]/, "mobile shell header stays above route content");
requireText("src/stores/useSettingsStore.ts", /const defaultAdvancedServerAddress = isNativeMobileBuild \? "" : "localhost:50051";/, "mobile settings avoids localhost advanced server fallback");
requireText("src/stores/useSettingsStore.ts", /serverAddress: settingsString\(source, "advanced", "server_address", defaultAdvancedServerAddress\)/, "advanced server address uses platform-aware fallback");
requireFile("src/pages/Extensions/mobile/index.tsx");
requireText("src/pages/Extensions/index.tsx", /import\.meta\.env\.MODE === "mobile"[\s\S]{0,120}lazy\(\(\) => import\("\.\/mobile"\)\)/, "mobile Extensions route uses mobile redirect component");
requireText("src/pages/Extensions/mobile/index.tsx", /<Navigate to="\/files" replace \/>/, "mobile Extensions page redirects to Files");
requireText("src-tauri/src/services/mod.rs", /#\[cfg\(desktop\)\]\s*pub mod plugin_commands;/, "native plugin command service is desktop-only");
requireText("src-tauri/src/runtime.rs", /#\[cfg\(desktop\)\]\s*use crate::services::plugin_commands::PluginCommandService;/, "native plugin command import is desktop-only");
requireText("src-tauri/src/runtime.rs", /#\[cfg\(desktop\)\]\s*pub plugin_commands: PluginCommandService,/, "native plugin command runtime field is desktop-only");
requireText("src-tauri/src/runtime.rs", /#\[cfg\(desktop\)\]\s*let plugin_commands = PluginCommandService::new\(environment\.clone\(\)\);/, "native plugin command runtime initialization is desktop-only");
requireText("src-tauri/src/lib.rs", /#\[cfg\(desktop\)\]\s*scan_local_plugins,[\s\S]{0,120}#\[cfg\(desktop\)\]\s*install_plugin_bundle,[\s\S]{0,120}#\[cfg\(desktop\)\]\s*set_plugin_enabled,[\s\S]{0,120}#\[cfg\(desktop\)\]\s*uninstall_plugin,/, "native plugin install command registration is desktop-only");
requireText("src-tauri/src/lib.rs", /#\[cfg\(desktop\)\]\s*plugin_commands_snapshot,[\s\S]{0,120}#\[cfg\(desktop\)\]\s*plugin_command_run,[\s\S]{0,120}#\[cfg\(desktop\)\]\s*plugin_panel_render,[\s\S]{0,120}#\[cfg\(desktop\)\]\s*plugin_diagnostics_snapshot,/, "native plugin command registration is desktop-only");
requireText("src-tauri/src/commands.rs", /#\[cfg\(mobile\)\][\s\S]{0,120}pub async fn plugin_commands_snapshot\(\) -> ApiResult<serde_json::Value>[\s\S]{0,80}Err\(mobile_plugins_unavailable\(\)\)/, "unregistered mobile plugin command snapshot stub");
requireText("src-tauri/src/commands.rs", /#\[cfg\(mobile\)\][\s\S]{0,120}pub async fn plugin_command_run\(_request: serde_json::Value\) -> ApiResult<serde_json::Value>[\s\S]{0,80}Err\(mobile_plugins_unavailable\(\)\)/, "unregistered mobile plugin command run stub");
requireText("src-tauri/src/commands.rs", /#\[cfg\(mobile\)\][\s\S]{0,120}pub async fn plugin_panel_render\(_request: serde_json::Value\) -> ApiResult<serde_json::Value>[\s\S]{0,80}Err\(mobile_plugins_unavailable\(\)\)/, "unregistered mobile plugin panel render stub");
requireText("src-tauri/src/commands.rs", /#\[cfg\(mobile\)\][\s\S]{0,120}pub async fn plugin_diagnostics_snapshot\(\) -> ApiResult<serde_json::Value>[\s\S]{0,80}Err\(mobile_plugins_unavailable\(\)\)/, "unregistered mobile plugin diagnostics stub");
for (const [page, target, label] of [
  ["Home", "/files", "mobile Home page redirects to Files"],
  ["Changelog", "/files", "mobile Changelog page redirects to Files"],
  ["SignIn", "/account/signin", "mobile SignIn page redirects to Account sign-in"],
  ["Register", "/account/register", "mobile Register page redirects to Account registration"],
]) {
  requireFile(`src/pages/${page}/mobile/index.tsx`);
  requireText(`src/pages/${page}/index.tsx`, /import\.meta\.env\.MODE === "mobile"[\s\S]{0,140}lazy\(\(\) => import\("\.\/mobile"\)\)/, `${label} entrypoint`);
  requireText(`src/pages/${page}/mobile/index.tsx`, new RegExp(`<Navigate to="${target.replace(/\//g, "\\/")}" replace \\/>`), label);
}
requireText("src/main.tsx", /!isNativeMobileBuild[\s\S]{0,120}import\.meta\.env\.VITE_MISTY_DEBUG === "1"[\s\S]{0,160}void import\("\.\/shared\/debug\/clientDebug"\)/, "non-mobile-only client debug installer");
scanFile("src/router.tsx", [
  "MobileDesktopRequiredPage",
  "Desktop only",
  "{ id: \"diagnostics\", label: \"Diagnostics\"",
], "mobile router desktop-only fallback source");
requireText("src/router.tsx", /path: "diagnostics"[\s\S]{0,220}mobile=\{<Navigate to=\{routes\.accountSettings\} replace \/>\}/, "mobile diagnostics route redirects to Settings");
requireText("src/router.tsx", /path: "signin"[\s\S]{0,220}mobile=\{<Navigate to=\{routes\.accountSignIn\} replace \/>\}/, "mobile top-level SignIn route redirects to Account sign-in");
requireText("src/router.tsx", /path: "register"[\s\S]{0,220}mobile=\{<Navigate to=\{routes\.accountRegister\} replace \/>\}/, "mobile top-level Register route redirects to Account registration");
scanFile("src/stores/useAppRouteMemoryStore.ts", [
  'pathname === "/diagnostics"',
], "route memory excludes mobile diagnostics");

const archiveInfo = "src-tauri/gen/apple/build/misty-desktop_iOS.xcarchive/Products/Applications/Misty.app/Info.plist";
if (existsSync(rel(archiveInfo))) {
  requirePlistValue(archiveInfo, "CFBundleIdentifier", "com.misty.mobile");
  requirePlistValue(archiveInfo, "CFBundleVersion", "1");
  requirePlistValue(archiveInfo, "MinimumOSVersion", "15.0");
  requirePlistValue(archiveInfo, "UIDeviceFamily.0", "1");
  requirePlistMissing(archiveInfo, "UIDeviceFamily.1", "iPad device family");
  requirePlistValue(archiveInfo, "UISupportedInterfaceOrientations.0", "UIInterfaceOrientationPortrait");
  requirePlistMissing(archiveInfo, "UISupportedInterfaceOrientations.1", "unverified iPhone landscape orientation");
  requirePlistMissing(archiveInfo, "UISupportedInterfaceOrientations~ipad", "iPad-specific orientation metadata");
  requirePlistValue(archiveInfo, "ITSAppUsesNonExemptEncryption", "false");
  requirePlistValue(archiveInfo, "CFBundleIcons.CFBundlePrimaryIcon.CFBundleIconName", "AppIcon");
} else {
  markWarn(`Archive app Info.plist not present yet: ${archiveInfo}`);
}

const archivePrivacyManifest = "src-tauri/gen/apple/build/misty-desktop_iOS.xcarchive/Products/Applications/Misty.app/PrivacyInfo.xcprivacy";
if (existsSync(rel(archivePrivacyManifest))) {
  requirePlistValue(archivePrivacyManifest, "NSPrivacyTracking", "false");
  requirePlistMissing(archivePrivacyManifest, "NSPrivacyTrackingDomains.0", "privacy manifest tracking domains");
  try {
    run("node", ["scripts/build-ios-release.mjs", "--validate-only"]);
    markPass("iOS archive validation script passes against the current archive");
  } catch (error) {
    markError(`iOS archive validation script failed: ${error.message}`);
  }
} else {
  markWarn(`Archive privacy manifest not present yet: ${archivePrivacyManifest}`);
}

const archiveAppDir = "src-tauri/gen/apple/build/misty-desktop_iOS.xcarchive/Products/Applications/Misty.app";
if (existsSync(rel(archiveAppDir))) {
  requireFile(`${archiveAppDir}/Assets.car`);
  requireMissing(`${archiveAppDir}/libapp.a`, "archive bundled Rust static library resource");
  scanBinaryFile(`${archiveAppDir}/Misty`, [
    "scan_local_plugins",
    "install_plugin_bundle",
    "set_plugin_enabled",
    "uninstall_plugin",
    "plugin_commands_snapshot",
    "plugin_command_run",
    "plugin_panel_render",
    "plugin_diagnostics_snapshot",
    "PluginCommandService",
    "load_native_plugin",
    "MistyPluginAbi",
    "misty_plugin_register",
  ], "mobile archive native extension command table");
  requireImageSize(`${archiveAppDir}/AppIcon60x60@2x.png`, 120, 120);
  requireImageOpaque(`${archiveAppDir}/AppIcon60x60@2x.png`);
  requireImageSize(`${archiveAppDir}/AppIcon76x76@2x~ipad.png`, 152, 152);
  requireImageOpaque(`${archiveAppDir}/AppIcon76x76@2x~ipad.png`);
}

if (requireDir("dist")) {
  scanFiles("dist", [
    "Browse extensions",
    "Manage extensions",
    "Search extensions",
    "Installed extensions",
    "Misty - Extensions",
    "usePluginsStore",
    "pluginCommandRun",
    "pluginPanelRender",
  ], "mobile dist extension UI");
  scanFiles("dist", [
    "pricing",
    "payment",
    "purchase",
    "upgrade",
    "external payment",
    "website purchase",
    "subscribe on website",
  ], "mobile dist App Review commerce copy");
	  scanFiles("dist", [
	    "http://localhost",
    "http://127.0.0.1",
    "http://0.0.0.0",
    "http://192.168.",
    "http://10.",
    "http://172.16.",
    "http://172.17.",
    "http://172.18.",
    "http://172.19.",
    "http://172.20.",
    "http://172.21.",
    "http://172.22.",
    "http://172.23.",
    "http://172.24.",
    "http://172.25.",
    "http://172.26.",
    "http://172.27.",
    "http://172.28.",
    "http://172.29.",
	    "http://172.30.",
	    "http://172.31.",
	  ], "mobile dist debug/private HTTP endpoints", [
	    /http:\/\/localhost[\s\S]{0,260}No window\.location\.\(origin\|href\) available to create URL/,
	  ]);
  scanFiles("dist", [
    "Misty server API",
    "Server env",
    "Clear debug events",
    "No client errors recorded yet",
    "misty.clientDebug.events.v1",
    "Action debug",
    "Hide action debug",
    "Provider auth debug",
    "Mobile shell",
    "v0.1.0-beta",
  ], "mobile dist production debug UI");
  scanFiles("dist", [
    "preview@misty.local",
    "Browser Preview",
    "browser-preview",
  ], "mobile dist browser-preview auth bypass");
  scanFiles("dist", [
    "Mika AI is coming soon",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "Desktop only",
    "desktop_notifications_enabled",
    "Open With...",
    "Choose Application",
    "Upload Folder",
    "Tauri desktop runtime",
    "desktop runtime",
    "Tauri app",
    "not available on mobile yet",
    "Use the desktop app",
  ], "mobile dist assistant/dead-feature UI");
}

scanFile(".env.mobile", [
  "VITE_MISTY_SERVER_URL=http://localhost",
  "VITE_API_BASE=http://localhost",
  "VITE_MISTY_SERVER_URL=http://127.0.0.1",
  "VITE_API_BASE=http://127.0.0.1",
  "VITE_MISTY_SERVER_URL=http://192.168.",
  "VITE_API_BASE=http://192.168.",
], "mobile env debug/private account API");

scanFiles("marketing/app-store-metadata/en-US", [
  "external purchase",
  "subscribe on website",
  "payment link",
  "paid upgrade",
], "metadata App Review commerce copy", [
  /does not include in-app purchases, external purchase prompts/i,
  /no in-app purchases, external purchase prompts/i,
]);

scanFiles("marketing/app-store-metadata/en-US", [
  "replace with",
  "placeholder",
  "tbd",
  "todo",
], "metadata placeholder language");

scanFiles("marketing/app-store-metadata/en-US", [
  "demo mode",
  "provided demo mode",
], "metadata unsupported reviewer demo mode language");

scanFiles("marketing/app-store-metadata/en-US", [
  "diagnostics controls",
], "metadata reviewer-facing diagnostics-control copy");

if (!existsSync(rel("marketing/app-store-screenshots/mobile/final/iphone-6-9/en-US/butterkit"))) {
  const draftSuffix = existsSync(rel("marketing/app-store-screenshots/mobile/final/iphone-6-9/en-US/butterkit-watermarked-draft"))
    ? " A watermarked Butterkit draft exists and must not be uploaded."
    : "";
  markWarn(`Submission-safe Butterkit export folder is not present yet: marketing/app-store-screenshots/mobile/final/iphone-6-9/en-US/butterkit.${draftSuffix}`);
}
if (existsSync(rel("marketing/app-store-screenshots/mobile/final/iphone-6-9/en-US/butterkit-watermarked-draft"))) {
  requireFile("marketing/app-store-screenshots/mobile/final/iphone-6-9/en-US/butterkit-watermarked-draft/DO_NOT_UPLOAD.md");
  requireText(
    "marketing/app-store-screenshots/mobile/final/iphone-6-9/en-US/butterkit-watermarked-draft/DO_NOT_UPLOAD.md",
    /include a visible `Made with ButterKit` watermark/,
    "watermarked Butterkit draft warning",
  );
  requireText(
    "marketing/app-store-screenshots/mobile/final/iphone-6-9/en-US/butterkit-watermarked-draft/DO_NOT_UPLOAD.md",
    /before final UI approval/,
    "pre-UI-approval Butterkit draft warning",
  );
}
if (!process.env.MISTY_IOS_DEVELOPMENT_TEAM && !process.env.APPLE_DEVELOPMENT_TEAM) {
  markWarn("No Apple team env var detected. Set MISTY_IOS_DEVELOPMENT_TEAM for archive/export or APPLE_DEVELOPMENT_TEAM for simulator/device dev.");
}

console.log("Misty mobile release readiness verification\n");
for (const message of passes) console.log(`PASS ${message}`);
for (const message of warnings) console.log(`WARN ${message}`);
for (const message of errors) console.log(`FAIL ${message}`);

console.log(`\nSummary: ${passes.length} passed, ${warnings.length} warnings, ${errors.length} failures.`);

if (errors.length > 0) {
  process.exit(1);
}
