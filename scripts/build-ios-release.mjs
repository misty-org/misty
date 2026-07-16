import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildNumber = process.env.MISTY_IOS_BUILD_NUMBER ?? "1";
const exportMethod = process.env.MISTY_IOS_EXPORT_METHOD ?? "app-store-connect";
const bundleId = process.env.TAURI_IOS_BUNDLE_ID ?? process.env.MISTY_IOS_BUNDLE_ID ?? "com.misty.mobile";
const developmentTeam = process.env.MISTY_IOS_DEVELOPMENT_TEAM ?? process.env.APPLE_DEVELOPMENT_TEAM ?? "";
const skipSigningPreflight = process.env.MISTY_IOS_SKIP_SIGNING_PREFLIGHT === "1";
const validateOnly = process.argv.includes("--validate-only");
const preflightOnly = process.argv.includes("--preflight-only");

const appInfoPlist = resolve(
  appDir,
  "src-tauri/gen/apple/build/misty-desktop_iOS.xcarchive/Products/Applications/Misty.app/Info.plist",
);
const appPrivacyManifest = resolve(
  appDir,
  "src-tauri/gen/apple/build/misty-desktop_iOS.xcarchive/Products/Applications/Misty.app/PrivacyInfo.xcprivacy",
);
const appBundleDir = resolve(
  appDir,
  "src-tauri/gen/apple/build/misty-desktop_iOS.xcarchive/Products/Applications/Misty.app",
);

if (validateOnly) {
  validateArchive(appInfoPlist, appPrivacyManifest);
  process.exit(0);
}

if (!developmentTeam.trim()) {
  fail([
    "MISTY_IOS_DEVELOPMENT_TEAM or APPLE_DEVELOPMENT_TEAM is required for an App Store/TestFlight archive.",
    "Set it to the Apple Developer Team ID that owns the iOS bundle identifier.",
  ]);
}

if (!/^[A-Z0-9]{10}$/.test(developmentTeam.trim())) {
  fail([
    `MISTY_IOS_DEVELOPMENT_TEAM="${developmentTeam}" does not look like a 10-character Apple Developer Team ID.`,
    "If you used APPLE_DEVELOPMENT_TEAM instead, check that value.",
    "Use the Team ID from Apple Developer > Membership or Xcode > Settings > Accounts.",
  ]);
}

if (!/^\d+(?:\.\d+){0,2}$/.test(buildNumber)) {
  fail([
    `MISTY_IOS_BUILD_NUMBER="${buildNumber}" is not an App Store-valid CFBundleVersion value.`,
    "Use a numeric build number such as 1, 2, or 1.0.1.",
  ]);
}

if (!["app-store-connect", "release-testing", "debugging"].includes(exportMethod)) {
  fail(`Unsupported MISTY_IOS_EXPORT_METHOD "${exportMethod}". Use app-store-connect, release-testing, or debugging.`);
}

mkdirSync(resolve(appDir, "build/ios-release"), { recursive: true });

preflightXcodeAndSigning();

if (preflightOnly) {
  console.log("Validated iOS archive signing preflight. No archive was built because --preflight-only was used.");
  process.exit(0);
}

const clang = output("xcrun", ["--sdk", "iphoneos", "--find", "clang"]);

run("npm", ["run", "service:archive:ios"]);
run("npm", [
  "run",
  "tauri",
  "--",
  "ios",
  "build",
  "--target",
  "aarch64",
  "--features",
  "embedded-storage-go",
  "--build-number",
  buildNumber,
  "--export-method",
  exportMethod,
  "--ci",
], {
  SWIFT_RS_CLANG: clang,
  MISTY_SERVICE_GO_LIB_DIR: "src-tauri/target/misty-service/ios-arm64",
  TAURI_IOS_BUNDLE_ID: bundleId,
  APPLE_DEVELOPMENT_TEAM: developmentTeam,
  DEVELOPMENT_TEAM: developmentTeam,
  VITE_MISTY_IOS_BUILD_NUMBER: buildNumber,
});

validateArchive(appInfoPlist, appPrivacyManifest);

function preflightXcodeAndSigning() {
  const xcodebuild = output("xcrun", ["--find", "xcodebuild"]);
  const clang = output("xcrun", ["--sdk", "iphoneos", "--find", "clang"]);
  if (!xcodebuild || !clang) {
    fail([
      "Xcode command-line tools are not available for iOS archive creation.",
      "Install Xcode, open it once, accept the license, and run `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` if needed.",
    ]);
  }

  if (skipSigningPreflight) {
    console.warn("Skipping local signing identity preflight because MISTY_IOS_SKIP_SIGNING_PREFLIGHT=1.");
    return;
  }

  const expectedIdentity = exportMethod === "debugging" ? "Apple Development" : "Apple Distribution";
  const identities = output("security", ["find-identity", "-v", "-p", "codesigning"], { allowFailure: true });
  if (!identities.includes(expectedIdentity)) {
    fail([
      `No local "${expectedIdentity}" code-signing identity was found for MISTY_IOS_EXPORT_METHOD=${exportMethod}.`,
      "Open Xcode > Settings > Accounts, sign in with the Apple Developer account, select the team, and download/create signing certificates.",
      "If signing is handled by another CI/keychain step, set MISTY_IOS_SKIP_SIGNING_PREFLIGHT=1 and ensure that step installs the required identity before archive export.",
    ]);
  }
}

function validateArchive(infoPlist, privacyManifest) {
  if (!existsSync(infoPlist)) {
    fail(`The iOS archive app Info.plist was not found at ${infoPlist}.`);
  }
  if (!existsSync(privacyManifest)) {
    fail([
      `The iOS archive is missing PrivacyInfo.xcprivacy at ${privacyManifest}.`,
      "Do not upload this archive. App Store submissions require a bundled privacy manifest.",
    ]);
  }
  assertFileExists(resolve(appBundleDir, "Assets.car"), [
    "The archive is missing the compiled asset catalog.",
  ]);
  assertFileMissing(resolve(appBundleDir, "libapp.a"), [
    "The Rust static library must be linked, not copied as an app resource.",
    "Check the XcodeGen buildPhase for the Externals source group.",
  ]);

  assertPlistValue(infoPlist, "CFBundleIdentifier", bundleId, [
    "The archive bundle identifier does not match the requested iOS bundle identifier.",
    "Check MISTY_IOS_BUNDLE_ID/TAURI_IOS_BUNDLE_ID and src-tauri/tauri.ios.conf.json.",
  ]);
  assertPlistValue(infoPlist, "CFBundleShortVersionString", "0.1.0", [
    "The archive marketing version does not match the App Store metadata draft.",
    "Update the metadata draft or the Tauri/iOS project version before upload.",
  ]);
  assertPlistValue(infoPlist, "CFBundleVersion", buildNumber, [
    "Do not upload this archive. Re-run with MISTY_IOS_BUILD_NUMBER set to an App Store-valid integer.",
  ]);
  assertPlistValue(infoPlist, "MinimumOSVersion", "15.0", [
    "The archive deployment target changed. Confirm iOS support policy before upload.",
  ]);
  assertPlistValue(infoPlist, "UIDeviceFamily.0", "2", [
    "Misty is an iPad-only App Store submission.",
    "Set TARGETED_DEVICE_FAMILY to 2 and rebuild the archive.",
  ]);
  assertPlistMissing(infoPlist, "UIDeviceFamily.1", [
    "The archive declares more than one device family. Misty supports iPad only.",
  ]);
  assertPlistValue(infoPlist, "UISupportedInterfaceOrientations.0", "UIInterfaceOrientationPortrait", [
    "Misty iPad supports portrait and landscape orientations.",
  ]);
  assertPlistValue(infoPlist, "UISupportedInterfaceOrientations.1", "UIInterfaceOrientationLandscapeLeft", [
    "Misty iPad supports landscape-left orientation.",
  ]);
  assertPlistValue(infoPlist, "UISupportedInterfaceOrientations.2", "UIInterfaceOrientationLandscapeRight", [
    "Misty iPad supports landscape-right orientation.",
  ]);
  assertPlistValue(infoPlist, "CFBundleURLTypes.0.CFBundleURLSchemes.0", "misty", [
    "The archive is missing the misty deep-link URL scheme used for provider auth returns.",
  ]);
  assertPlistValue(infoPlist, "NSAppTransportSecurity.NSAllowsLocalNetworking", "true", [
    "The archive no longer allows local networking required by Misty's local secure runtime.",
  ]);
  assertPlistValue(infoPlist, "NSLocalNetworkUsageDescription", "Misty uses local secure runtime services on this device to browse and transfer files.", [
    "The archive local network purpose string changed. Review App Review-safe permission copy before upload.",
  ]);
  assertPlistValue(infoPlist, "ITSAppUsesNonExemptEncryption", "false", [
    "The archive export-compliance answer changed. Confirm encryption compliance before upload.",
  ]);
  assertPlistValue(privacyManifest, "NSPrivacyTracking", "false", [
    "The privacy manifest tracking declaration changed. Reconcile with App Store privacy labels before upload.",
  ]);
  assertPlistMissing(privacyManifest, "NSPrivacyTrackingDomains.0", [
    "The privacy manifest declares tracking domains. Reconcile tracking declarations and App Store privacy labels before upload.",
  ]);
  for (const category of [
    "NSPrivacyAccessedAPICategoryFileTimestamp",
    "NSPrivacyAccessedAPICategoryDiskSpace",
    "NSPrivacyAccessedAPICategorySystemBootTime",
    "NSPrivacyAccessedAPICategoryUserDefaults",
  ]) {
    assertPlistContains(privacyManifest, "NSPrivacyAccessedAPITypes", category, [
      `The privacy manifest is missing the ${category} required-reason API declaration.`,
    ]);
  }
  for (const reason of ["C617.1", "E174.1", "35F9.1", "CA92.1"]) {
    assertPlistContains(privacyManifest, "NSPrivacyAccessedAPITypes", reason, [
      `The privacy manifest is missing required-reason code ${reason}.`,
    ]);
  }
  for (const dataType of [
    "NSPrivacyCollectedDataTypeEmailAddress",
    "NSPrivacyCollectedDataTypeName",
    "NSPrivacyCollectedDataTypeUserID",
    "NSPrivacyCollectedDataTypeOtherUserContent",
    "NSPrivacyCollectedDataTypeCrashData",
    "NSPrivacyCollectedDataTypePerformanceData",
  ]) {
    assertPlistContains(privacyManifest, "NSPrivacyCollectedDataTypes", dataType, [
      `The privacy manifest is missing collected-data declaration ${dataType}.`,
    ]);
  }
  assertPngSize(resolve(appBundleDir, "AppIcon76x76@2x~ipad.png"), 152, 152, [
    "The archive is missing the primary iPad icon output or it has the wrong size.",
  ]);
  assertPngOpaque(resolve(appBundleDir, "AppIcon76x76@2x~ipad.png"), [
    "The archive iPad app icon still has an alpha channel. Run npm run icons:ios:flatten and rebuild.",
  ]);

  console.log("Validated iOS archive Info.plist, PrivacyInfo.xcprivacy, and app icons for App Store readiness.");
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: appDir,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function output(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: appDir,
    encoding: "utf8",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (options.allowFailure) return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

function plistValue(plist, key) {
  return output("plutil", ["-extract", key, "raw", plist]);
}

function optionalPlistValue(plist, key) {
  const result = spawnSync("plutil", ["-extract", key, "raw", plist], {
    cwd: appDir,
    encoding: "utf8",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function assertPlistValue(plist, key, expected, detail = []) {
  let actual;
  try {
    actual = plistValue(plist, key);
  } catch {
    fail([`The iOS archive is missing ${key} in ${plist}.`, ...detail]);
  }
  if (actual !== expected) {
    fail([`The iOS archive ${key} is "${actual}", expected "${expected}".`, ...detail]);
  }
}

function assertPlistMissing(plist, key, detail = []) {
  const actual = optionalPlistValue(plist, key);
  if (actual !== null) {
    fail([`The iOS archive unexpectedly includes ${key}="${actual}" in ${plist}.`, ...detail]);
  }
}

function assertPlistContains(plist, key, expectedSubstring, detail = []) {
  let actual;
  try {
    actual = output("plutil", ["-extract", key, "xml1", "-o", "-", plist]);
  } catch {
    fail([`The iOS archive is missing ${key} in ${plist}.`, ...detail]);
  }
  if (!actual.includes(expectedSubstring)) {
    fail([`The iOS archive ${key} does not include "${expectedSubstring}".`, ...detail]);
  }
}

function assertFileExists(file, detail = []) {
  if (!existsSync(file)) {
    fail([`The iOS archive is missing ${file}.`, ...detail]);
  }
}

function assertFileMissing(file, detail = []) {
  if (existsSync(file)) {
    fail([`The iOS archive unexpectedly includes ${file}.`, ...detail]);
  }
}

function pngSize(file) {
  assertFileExists(file);
  const details = output("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file]);
  const width = details.match(/pixelWidth:\s*(\d+)/)?.[1];
  const height = details.match(/pixelHeight:\s*(\d+)/)?.[1];
  if (!width || !height) {
    fail(`Could not inspect PNG dimensions for ${file}.`);
  }
  return { width: Number(width), height: Number(height) };
}

function assertPngSize(file, expectedWidth, expectedHeight, detail = []) {
  const actual = pngSize(file);
  if (actual.width !== expectedWidth || actual.height !== expectedHeight) {
    fail([
      `The iOS archive icon ${file} is ${actual.width}x${actual.height}, expected ${expectedWidth}x${expectedHeight}.`,
      ...detail,
    ]);
  }
}

function assertPngOpaque(file, detail = []) {
  assertFileExists(file);
  const details = output("sips", ["-g", "hasAlpha", file]);
  const hasAlpha = details.match(/hasAlpha:\s*(\w+)/)?.[1]?.toLowerCase();
  if (hasAlpha !== "no") {
    fail([`The iOS archive icon ${file} reports hasAlpha=${hasAlpha ?? "unknown"}.`, ...detail]);
  }
}

function fail(message) {
  const lines = Array.isArray(message) ? message : [message];
  for (const line of lines) {
    console.error(line);
  }
  process.exit(1);
}
