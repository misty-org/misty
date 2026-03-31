#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skipBuild = process.argv.includes("--skip-build");
const errors = [];
const warnings = [];
const passes = [];

if (!skipBuild) run("npm", ["run", "build:mobile"], { stdio: "inherit" });

requireJsonValue("src-tauri/tauri.android.conf.json", "identifier", "com.misty.mobile");
requireText("src-tauri/gen/android/app/build.gradle.kts", /applicationId = "com\.misty\.mobile"/, "applicationId com.misty.mobile");
requireText("src-tauri/gen/android/app/build.gradle.kts", /namespace = "com\.misty\.mobile"/, "namespace com.misty.mobile");
requireText("src-tauri/gen/android/app/build.gradle.kts", /targetSdk = 36/, "target SDK 36");
requireText("src-tauri/gen/android/app/build.gradle.kts", /minSdk = 28/, "min SDK 28");
requireText("src-tauri/gen/android/app/build.gradle.kts", /manifestPlaceholders\["usesCleartextTraffic"\] = "false"/, "release cleartext disabled");
requireText("src-tauri/gen/android/app/src/main/AndroidManifest.xml", /android\.permission\.INTERNET/, "INTERNET permission");
forbidText("src-tauri/gen/android/app/src/main/AndroidManifest.xml", /READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE|QUERY_ALL_PACKAGES|REQUEST_INSTALL_PACKAGES/, "broad Play-sensitive permissions");
requireText("src-tauri/gen/android/app/src/main/AndroidManifest.xml", /<data android:scheme="misty" \/>/, "misty deep-link scheme");
requireText("src-tauri/gen/android/app/src/main/res/values/strings.xml", /<string name="app_name">Misty<\/string>/, "Misty app name");
requireText("package.json", /"tauri:android:build:release-aab"/, "release AAB script");
requireText("package.json", /"package:google-play"/, "Google Play package script");
requireText("scripts/build-android-release.mjs", /MISTY_ANDROID_KEYSTORE_FILE/, "Android signing env validation");
requireText("src-tauri/Cargo.toml", /tauri-plugin-keystore = \{ path = "vendor\/tauri-plugin-keystore" \}/, "repo-owned secure storage plugin");
requireText("src-tauri/vendor/tauri-plugin-keystore/android/src/main/java/SecureTokenStore.kt", /AndroidKeyStore/, "Android Keystore-backed token key");
requireText("src-tauri/vendor/tauri-plugin-keystore/android/src/main/java/SecureTokenStore.kt", /AES\/GCM\/NoPadding/, "authenticated token encryption");
requireText("src-tauri/vendor/tauri-plugin-keystore/android/src/androidTest/java/SecureTokenStoreTest.kt", /tokenIsEncryptedRoundTripsAndCanBeRemoved/, "on-device secure storage test");
forbidText("src-tauri/vendor/tauri-plugin-keystore/android/build.gradle.kts", /androidx\.biometric|USE_BIOMETRIC|USE_FINGERPRINT/, "biometric dependency or permission");
forbidText("src-tauri/vendor/tauri-plugin-keystore/android/src/main/java/KeystorePlugin.kt", /BiometricPrompt|printStackTrace\(|Logger\./, "biometric prompt or sensitive debug logging");
forbidText("src-tauri/vendor/tauri-plugin-keystore/android/src/main/java/SecureTokenStore.kt", /BiometricPrompt|printStackTrace\(|Logger\./, "biometric prompt or sensitive debug logging");
requireText("marketing/google-play-metadata/en-US/play-store-listing.json", /"packageName": "com\.misty\.mobile"/, "metadata package name");
forbidText("marketing/google-play-metadata/en-US/play-store-listing.json", /SUPPLY_|PLACEHOLDER|example\.com|yourdomain/i, "placeholder or fake URL values");
requireText("marketing/google-play-metadata/en-US/review-notes.md", /does not include in-app purchases/i, "Play review no-IAP note");
requireText("marketing/google-play-metadata/en-US/publish-checklist.md", /Android App Bundle/i, "publish checklist AAB step");
requireScreenshotSet("marketing/google-play-screenshots/mobile/raw/phone", { minCount: 4, width: 1080, height: 1920 });
requireScreenshotSet("marketing/google-play-screenshots/mobile/final/phone-1080x1920/en-US", { minCount: 4, width: 1080, height: 1920 });
requireText("marketing/google-play-screenshots/mobile/manifest.md", /Google Play Screenshot Manifest/, "screenshot manifest");
requireText("docs/android-mobile-readiness.md", /Android Mobile Readiness/, "Android readiness doc");
requireText("docs/android-mobile-qa-log.md", /Android Mobile QA Log/, "Android QA log");
requireText("docs/android-security-review.md", /Android Security Audit/, "Android security report");
requireText("docs/android-completion-audit.md", /Android \/ Google Play Completion Audit/, "Android completion audit");
scanNoTerms("dist", [
  /\bsubscription\b/i,
  /\bupgrade\b/i,
  /\bpricing\b/i,
  /\bpurchase\b/i,
  /\bexternal payment\b/i,
  /browse extensions/i,
  /manage extensions/i,
  /Action debug/i,
  /Provider auth debug/i,
]);
verifyNewestDebugApk();

const report = [
  "# Android Release Verification",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  `Passes: ${passes.length}`,
  `Warnings: ${warnings.length}`,
  `Errors: ${errors.length}`,
  "",
  "## Errors",
  ...(errors.length > 0 ? errors.map((item) => `- ${item}`) : ["- None."]),
  "",
  "## Warnings",
  ...(warnings.length > 0 ? warnings.map((item) => `- ${item}`) : ["- None."]),
  "",
].join("\n");
mkdirSync(path.join(root, "build/android-release-verification"), { recursive: true });
writeFileSync(path.join(root, "build/android-release-verification/report.md"), report);

console.log(`Android release verification: ${passes.length} passes, ${warnings.length} warnings, ${errors.length} errors`);
if (errors.length > 0) process.exit(1);

function rel(...parts) {
  return path.join(root, ...parts);
}

function requireJsonValue(relativePath, key, expected) {
  if (!requireFile(relativePath)) return;
  const json = JSON.parse(readFileSync(rel(relativePath), "utf8"));
  if (json[key] !== expected) errors.push(`${relativePath} ${key} expected ${expected}, got ${json[key]}`);
  else passes.push(`${relativePath} ${key} is ${expected}`);
}

function requireFile(relativePath) {
  if (!existsSync(rel(relativePath)) || !statSync(rel(relativePath)).isFile()) {
    errors.push(`Missing file: ${relativePath}`);
    return false;
  }
  passes.push(`Found ${relativePath}`);
  return true;
}

function requireText(relativePath, pattern, label) {
  if (!requireFile(relativePath)) return;
  const text = readFileSync(rel(relativePath), "utf8");
  if (!pattern.test(text)) errors.push(`${relativePath} missing ${label}`);
  else passes.push(`${relativePath}: ${label}`);
}

function forbidText(relativePath, pattern, label) {
  if (!requireFile(relativePath)) return;
  const text = readFileSync(rel(relativePath), "utf8");
  if (pattern.test(text)) errors.push(`${relativePath} contains ${label}`);
  else passes.push(`${relativePath}: no ${label}`);
}

function requireScreenshotSet(relativePath, options) {
  const dir = rel(relativePath);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    errors.push(`Missing screenshot directory: ${relativePath}`);
    return;
  }
  const files = readdirSync(dir).filter((file) => /\.png$/i.test(file)).sort();
  if (files.length < options.minCount) {
    errors.push(`${relativePath} has ${files.length} PNGs; expected at least ${options.minCount}`);
    return;
  }
  for (const file of files) {
    const size = imageSize(path.join(relativePath, file));
    if (size.width !== options.width || size.height !== options.height) {
      errors.push(`${relativePath}/${file} expected ${options.width}x${options.height}, got ${size.width}x${size.height}`);
    } else {
      passes.push(`${relativePath}/${file} is ${options.width}x${options.height}`);
    }
    if (imageHasAlpha(path.join(relativePath, file))) {
      errors.push(`${relativePath}/${file} has alpha; Google Play screenshots must be JPEG or 24-bit PNG without alpha`);
    } else {
      passes.push(`${relativePath}/${file} has no alpha`);
    }
  }
}

function imageSize(relativePath) {
  const output = runCapture("sips", ["-g", "pixelWidth", "-g", "pixelHeight", rel(relativePath)]);
  return {
    width: Number(output.match(/pixelWidth:\s*(\d+)/)?.[1] ?? 0),
    height: Number(output.match(/pixelHeight:\s*(\d+)/)?.[1] ?? 0),
  };
}

function imageHasAlpha(relativePath) {
  const output = runCapture("sips", ["-g", "hasAlpha", rel(relativePath)]);
  return /hasAlpha:\s*yes/i.test(output);
}

function scanNoTerms(relativePath, patterns) {
  const base = rel(relativePath);
  if (!existsSync(base)) {
    warnings.push(`Skipped dist scan; ${relativePath} does not exist.`);
    return;
  }
  const hits = [];
  for (const file of listFiles(base)) {
    if (!/\.(js|css|html)$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const pattern of patterns) {
      if (pattern.test(text)) hits.push(`${path.relative(root, file)}: ${pattern}`);
    }
  }
  if (hits.length > 0) errors.push(`Mobile dist contains disallowed Android release strings:\n  ${hits.slice(0, 30).join("\n  ")}`);
  else passes.push("Mobile dist contains no Android release disallowed strings");
}

function listFiles(dir) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  walk(dir);
  return files;
}

function verifyNewestDebugApk() {
  const outputDir = rel("src-tauri/gen/android/app/build/outputs/apk");
  if (!existsSync(outputDir)) {
    warnings.push("No debug APK found for merged-manifest verification.");
    return;
  }
  const apks = listFiles(outputDir).filter((file) => file.endsWith(".apk"));
  if (apks.length === 0) {
    warnings.push("No debug APK found for merged-manifest verification.");
    return;
  }
  const apk = apks.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0];
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  const buildToolsDir = sdk ? path.join(sdk, "build-tools") : "";
  if (!buildToolsDir || !existsSync(buildToolsDir)) {
    warnings.push("ANDROID_HOME/ANDROID_SDK_ROOT is unavailable; skipped packaged APK inspection.");
    return;
  }
  const aapt = readdirSync(buildToolsDir)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
    .map((version) => path.join(buildToolsDir, version, "aapt"))
    .find((candidate) => existsSync(candidate));
  if (!aapt) {
    warnings.push("Android build-tools aapt is unavailable; skipped packaged APK inspection.");
    return;
  }
  const badging = runCapture(aapt, ["dump", "badging", apk]);
  const relativeApk = path.relative(root, apk);
  if (!/package: name='com\.misty\.mobile' versionCode='\d+' versionName='[^']+'/.test(badging)) {
    errors.push(`${relativeApk} has an invalid package identity/version`);
  } else {
    passes.push(`${relativeApk} has package com.misty.mobile and explicit version metadata`);
  }
  if (!/sdkVersion:'28'/.test(badging) || !/targetSdkVersion:'36'/.test(badging)) {
    errors.push(`${relativeApk} must target Android minSdk 28 / targetSdk 36`);
  } else {
    passes.push(`${relativeApk} targets minSdk 28 / targetSdk 36`);
  }
  if (!/native-code: 'arm64-v8a'/.test(badging)) {
    errors.push(`${relativeApk} debug artifact must contain arm64-v8a native code`);
  } else {
    passes.push(`${relativeApk} contains arm64-v8a native code`);
  }
  const permissions = [...badging.matchAll(/uses-permission: name='([^']+)'/g)].map((match) => match[1]);
  const allowed = new Set([
    "android.permission.INTERNET",
    "com.misty.mobile.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",
  ]);
  const unexpected = permissions.filter((permission) => !allowed.has(permission));
  if (unexpected.length > 0) {
    errors.push(`${relativeApk} contains unexpected merged permissions: ${unexpected.join(", ")}`);
  } else if (!permissions.includes("android.permission.INTERNET")) {
    errors.push(`${relativeApk} is missing android.permission.INTERNET`);
  } else {
    passes.push(`${relativeApk} merged permissions are minimal and expected`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout;
}

function runCapture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
}
