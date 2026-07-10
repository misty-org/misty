#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skipBuild = process.argv.includes("--skip-build");
const findings = [];
const passes = [];
const warnings = [];

if (!skipBuild) {
  run("npm", ["run", "build:mobile"], { stdio: "inherit" });
}

scanTextTree("src", [
  /AKIA[0-9A-Z]{16}/,
  /AIza[0-9A-Za-z_-]{35}/,
  /ghp_[0-9A-Za-z]{36}/,
  /sk-[A-Za-z0-9]{20,}/,
], "high-confidence secret formats");

scanMobileBundle([
  /\bsubscription\b/i,
  /\bupgrade\b/i,
  /\bpricing\b/i,
  /\bpurchase\b/i,
  /\bexternal payment\b/i,
  /browse extensions/i,
  /manage extensions/i,
  /install extension/i,
  /plugin catalog/i,
  /Action debug/i,
  /Provider auth debug/i,
], "Play policy and desktop-only mobile bundle strings");

requireText("src-tauri/gen/android/app/src/main/AndroidManifest.xml", /android\.permission\.INTERNET/, "INTERNET permission only baseline");
forbidText("src-tauri/gen/android/app/src/main/AndroidManifest.xml", /READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE|QUERY_ALL_PACKAGES|REQUEST_INSTALL_PACKAGES/, "broad Android runtime permissions");
requireText("src-tauri/gen/android/app/build.gradle.kts", /applicationId = "com\.misty\.mobile"/, "Android applicationId com.misty.mobile");
requireText("src-tauri/gen/android/app/build.gradle.kts", /namespace = "com\.misty\.mobile"/, "Android namespace com.misty.mobile");
requireText("src-tauri/gen/android/app/build.gradle.kts", /usesCleartextTraffic"\] = "false"/, "release cleartext traffic disabled");
requireText("src-tauri/gen/android/app/build.gradle.kts", /MISTY_ANDROID_KEYSTORE_FILE/, "release signing env preflight");
requireText("src-tauri/Cargo.toml", /tauri-plugin-keystore = \{ path = "vendor\/tauri-plugin-keystore" \}/, "repo-owned Android secure storage plugin");
requireText("src-tauri/vendor/tauri-plugin-keystore/android/src/main/java/SecureTokenStore.kt", /AndroidKeyStore/, "Android Keystore-backed auth token key");
requireText("src-tauri/vendor/tauri-plugin-keystore/android/src/main/java/SecureTokenStore.kt", /AES\/GCM\/NoPadding/, "AES-GCM auth token encryption");
forbidText("src-tauri/vendor/tauri-plugin-keystore/android/build.gradle.kts", /androidx\.biometric|USE_BIOMETRIC|USE_FINGERPRINT/, "unnecessary biometric dependency or permission");
forbidText("src-tauri/vendor/tauri-plugin-keystore/android/src/main/java/KeystorePlugin.kt", /BiometricPrompt|printStackTrace\(|Logger\./, "unnecessary biometric access or sensitive native debug logging");
forbidText("src-tauri/vendor/tauri-plugin-keystore/android/src/main/java/SecureTokenStore.kt", /BiometricPrompt|printStackTrace\(|Logger\./, "unnecessary biometric access or sensitive native debug logging");
requireText("src-tauri/vendor/tauri-plugin-keystore/android/src/androidTest/java/SecureTokenStoreTest.kt", /tokenIsEncryptedRoundTripsAndCanBeRemoved/, "Android secure storage instrumentation coverage");
requireText("src/pages/Extensions/mobile/index.tsx", /Navigate to="\/files"/, "mobile Extensions redirect");
requireText("src/router.tsx", /mobile=\{<Navigate to=\{routes\.files\} replace \/>\}/, "mobile desktop-only route redirects");
requireText("src/stores/useSettingsStore.ts", /isNativeMobileBuild \? "" : "localhost:50051"/, "mobile avoids localhost advanced server fallback");
forbidText("marketing/google-play-metadata/en-US/play-store-listing.json", /SUPPLY_|PLACEHOLDER|example\.com|yourdomain/i, "placeholder or fake Google Play metadata URL values");

const report = [
  "# Android Security Audit",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  "## Passes",
  ...passes.map((item) => `- ${item}`),
  "",
  "## Warnings",
  ...(warnings.length > 0 ? warnings.map((item) => `- ${item}`) : ["- None."]),
  "",
  "## Findings",
  ...(findings.length > 0 ? findings.map((item) => `- ${item}`) : ["- No critical or high-severity local Android findings in this automated pass."]),
  "",
].join("\n");

mkdirSync(path.join(root, "docs"), { recursive: true });
writeFileSync(path.join(root, "docs/android-security-review.md"), report);

console.log(`Android security audit: ${passes.length} passes, ${warnings.length} warnings, ${findings.length} findings`);
if (findings.length > 0) process.exit(1);

function rel(...parts) {
  return path.join(root, ...parts);
}

function requireText(relativePath, pattern, label) {
  const text = readMaybe(relativePath);
  if (!text) return;
  if (!pattern.test(text)) findings.push(`${relativePath} missing ${label}`);
  else passes.push(`${relativePath}: ${label}`);
}

function forbidText(relativePath, pattern, label) {
  const text = readMaybe(relativePath);
  if (!text) return;
  if (pattern.test(text)) findings.push(`${relativePath} contains ${label}`);
  else passes.push(`${relativePath}: no ${label}`);
}

function readMaybe(relativePath) {
  const absolute = rel(relativePath);
  if (!existsSync(absolute)) {
    findings.push(`Missing ${relativePath}`);
    return "";
  }
  return readFileSync(absolute, "utf8");
}

function scanMobileBundle(patterns, label) {
  const files = listFiles("dist").filter((file) => /\.(js|css|html)$/.test(file));
  if (files.length === 0) {
    warnings.push(`Skipped ${label}; dist is empty.`);
    return;
  }
  const hits = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const pattern of patterns) {
      if (pattern.test(text)) hits.push(`${path.relative(root, file)}: ${pattern}`);
    }
  }
  if (hits.length > 0) findings.push(`${label} found:\n  ${hits.slice(0, 30).join("\n  ")}`);
  else passes.push(`${label}: no hits`);
}

function scanTextTree(relativePath, patterns, label) {
  const hits = [];
  for (const file of listFiles(relativePath)) {
    if (!/\.(ts|tsx|js|mjs|rs|json|md|toml|kts|xml|properties|env)$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const pattern of patterns) {
      if (pattern.test(text)) hits.push(`${path.relative(root, file)}: ${pattern}`);
    }
  }
  if (hits.length > 0) findings.push(`${label} found:\n  ${hits.slice(0, 30).join("\n  ")}`);
  else passes.push(`${label}: no hits`);
}

function listFiles(relativePath) {
  const base = rel(relativePath);
  if (!existsSync(base)) return [];
  const output = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", "target", ".git"].includes(entry.name)) continue;
        walk(absolute);
      } else if (entry.isFile() && statSync(absolute).size < 5_000_000) {
        output.push(absolute);
      }
    }
  };
  walk(base);
  return output;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
