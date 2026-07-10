#!/usr/bin/env node

import { createReadStream, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(root, "build/google-play-package");
const logsDir = path.join(outputRoot, "validation-logs");

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(logsDir, { recursive: true });

runForLog("build-android", "npm", ["run", "build:android"]);
runForLog("android-security-audit", "npm", ["run", "security:android:audit", "--", "--skip-build"]);
runForLog("verify-android-release", "npm", ["run", "verify:android-release", "--", "--skip-build"]);
runDiagnosticLog("android-release-preflight", "npm", ["run", "tauri:android:build:preflight"]);

copy("marketing/google-play-screenshots/mobile", "screenshots/mobile");
copy("marketing/google-play-metadata/en-US", "metadata/en-US");
copy("docs/android-mobile-readiness.md", "docs/android-mobile-readiness.md");
copy("docs/android-mobile-qa-log.md", "docs/android-mobile-qa-log.md");
copy("docs/android-security-review.md", "docs/android-security-review.md");
copy("docs/android-completion-audit.md", "docs/android-completion-audit.md");
copy("scripts/build-android-release.mjs", "release-scripts/build-android-release.mjs");
copy("scripts/verify-android-release-readiness.mjs", "release-scripts/verify-android-release-readiness.mjs");
copy("scripts/audit-android-release.mjs", "release-scripts/audit-android-release.mjs");
copy("scripts/design-google-play-screenshots.swift", "release-scripts/design-google-play-screenshots.swift");
copy("src-tauri/tauri.android.conf.json", "android/config/tauri.android.conf.json");
copy("src-tauri/gen/android/app/build.gradle.kts", "android/generated/app/build.gradle.kts");
copy("src-tauri/gen/android/app/src/main/AndroidManifest.xml", "android/generated/app/src/main/AndroidManifest.xml");

const debugApkSource = "src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk";
const debugApk = existsSync(rel(debugApkSource))
  ? {
      sourcePath: debugApkSource,
      bytes: statSync(rel(debugApkSource)).size,
      sha256: await sha256File(rel(debugApkSource)),
      purpose: "Local QA only; do not upload this debug-signed APK to Google Play.",
    }
  : null;
const localReleaseAab = await localArtifact(
  "src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab",
  "Signed Google Play upload candidate. Verify the signer is the intended upload key before upload.",
);
const localReleaseApk = await localArtifact(
  "src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk",
  "Release smoke/testing only; Google Play submission uses the signed AAB.",
);
const instrumentationResultsDir = rel("src-tauri/vendor/tauri-plugin-keystore/android/build/outputs/androidTest-results/connected/debug");
const instrumentationResult = existsSync(instrumentationResultsDir)
  ? readdirSync(instrumentationResultsDir).find((file) => file.startsWith("TEST-") && file.endsWith(".xml"))
  : undefined;
if (instrumentationResult) {
  copy(
    path.relative(root, path.join(instrumentationResultsDir, instrumentationResult)),
    "qa/secure-storage-instrumentation.xml",
  );
}
if (localReleaseAab) {
  copy(localReleaseAab.sourcePath, "release/app-universal-release.aab");
  localReleaseAab.packagePath = "release/app-universal-release.aab";
}

const manifest = {
  generatedAt: new Date().toISOString(),
  packageRoot: "build/google-play-package",
  packageName: "com.misty.mobile",
  releaseArtifacts: {
    expectedAabCommand: "npm run tauri:android:build:release-aab",
    expectedApkCommand: "npm run tauri:android:build:release-apk",
    localDebugApkCommand: "npm run tauri:android:build:debug-apk",
    debugApk,
    localReleaseAab,
    localReleaseApk,
  },
  screenshots: {
    rawPhone: "screenshots/mobile/raw/phone",
    finalPhone: "screenshots/mobile/final/phone-1080x1920/en-US",
    manifest: "screenshots/mobile/manifest.md",
  },
  metadata: [
    "metadata/en-US/play-store-listing.json",
    "metadata/en-US/app-info.md",
    "metadata/en-US/review-notes.md",
    "metadata/en-US/data-safety-notes.md",
    "metadata/en-US/publish-checklist.md",
  ],
  qaEvidence: instrumentationResult ? "qa/secure-storage-instrumentation.xml" : null,
  remainingExternalBlockers: [
    "Restore and validate the production account API; https://mistysys.com/api/login returned Cloudflare 502 during final QA.",
    "Supply production support URL, privacy policy URL, and reviewer/demo credentials.",
    "Run final live provider OAuth/deep-link smoke with reviewer-safe credentials.",
    "Upload the signed AAB to Play Console and complete the Data safety form from the included draft.",
  ],
};
writeFileSync(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(path.join(outputRoot, "README.md"), `# Misty Google Play Package\n\nGenerated: ${manifest.generatedAt}\n\nUse \`metadata/en-US\`, \`screenshots/mobile/final/phone-1080x1920/en-US\`, and the signed AAB produced by \`npm run tauri:android:build:release-aab\` for Play Console submission.\n\nRelease signing credentials are intentionally not included. The debug APK recorded in \`manifest.json\` is QA-only and must not be uploaded to Google Play.\n`);

console.log(`Google Play package assembled at ${outputRoot}`);

function rel(...parts) {
  return path.join(root, ...parts);
}

function out(...parts) {
  return path.join(outputRoot, ...parts);
}

function copy(sourceRelative, destinationRelative) {
  const source = rel(sourceRelative);
  if (!existsSync(source)) throw new Error(`Missing package source: ${sourceRelative}`);
  const destination = out(destinationRelative);
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: statSync(source).isDirectory() });
}

function runForLog(name, command, args) {
  const result = runCommand(name, command, args);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed; see validation-logs/${name}.txt`);
  }
}

function runDiagnosticLog(name, command, args) {
  runCommand(name, command, args, "\nDiagnostic-only. A non-zero exit records an external credential/signing blocker.");
}

function runCommand(name, command, args, suffix = "") {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  const text = [
    `$ ${[command, ...args].join(" ")}`,
    "",
    result.stdout ?? "",
    result.stderr ? `\n[stderr]\n${result.stderr}` : "",
    `\nexitCode=${result.status ?? "error"}`,
    suffix,
  ].join("\n");
  writeFileSync(path.join(logsDir, `${name}.txt`), text);
  if (result.error) throw result.error;
  return result;
}

function sha256File(file) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("error", rejectHash);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

async function localArtifact(sourcePath, purpose) {
  const absolute = rel(sourcePath);
  if (!existsSync(absolute)) return null;
  return {
    sourcePath,
    bytes: statSync(absolute).size,
    sha256: await sha256File(absolute),
    purpose,
  };
}
