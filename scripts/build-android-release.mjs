#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const signingEnvFile = process.env.MISTY_ANDROID_SIGNING_ENV_FILE
  ?? resolve(appDir, "scripts/.signing.env");
const args = process.argv.slice(2);
const debug = args.includes("--debug");
const release = args.includes("--release") || !debug;
const apk = args.includes("--apk");
const aab = args.includes("--aab") || !apk;
const preflightOnly = args.includes("--preflight-only");
const targetOptionIndex = args.findIndex((arg) => arg === "--target");
const requestedTarget = args.find((arg) => arg.startsWith("--target="))?.slice("--target=".length)
  ?? (targetOptionIndex >= 0 ? args[targetOptionIndex + 1] : undefined);
const selectedTarget = requestedTarget ?? (debug ? "android-arm64" : undefined);
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? resolve(process.env.HOME ?? "", "Library/Android/sdk");
const javaHome = process.env.JAVA_HOME ?? "/Applications/Android Studio.app/Contents/jbr/Contents/Home";
const buildTargets = selectedTarget
  ? [selectedTarget]
  : ["android-arm64", "android-armv7", "android-x86", "android-x86_64"];

loadSigningEnvironment();
preflightAndroidEnvironment();
if (release) preflightReleaseSigning();

if (preflightOnly) {
  console.log("Android build preflight passed.");
  process.exit(0);
}

if (release) cleanAndroidOutputs();

const tauriArgs = ["run", "tauri", "--", "android", "build"];
if (debug) tauriArgs.push("--debug");
if (apk) tauriArgs.push("--apk");
if (aab) tauriArgs.push("--aab");
if (selectedTarget) tauriArgs.push("--target", androidCargoTarget(selectedTarget));
tauriArgs.push("--ci");

run("npm", tauriArgs, {
});

function preflightAndroidEnvironment() {
  requirePath(sdk, "Android SDK", "Set ANDROID_HOME or ANDROID_SDK_ROOT.");
  requirePath(resolve(sdk, "platform-tools/adb"), "adb", "Install Android SDK platform-tools.");
  requirePath(resolve(sdk, "emulator/emulator"), "Android emulator", "Install Android SDK emulator.");
  const ndkRoot = resolve(sdk, "ndk");
  requirePath(ndkRoot, "Android NDK directory", "Install a side-by-side NDK in Android Studio.");
  requirePath(resolve(javaHome, "bin/java"), "JDK 17+ java", "Set JAVA_HOME to Android Studio's bundled JBR or another JDK 17+.");
  for (const target of buildTargets) {
    const rustTarget = rustTargetFor(target);
    const installed = runCapture("rustup", ["target", "list", "--installed"]);
    if (!installed.split(/\s+/).includes(rustTarget)) {
      fail(`Missing Rust target ${rustTarget}. Run: rustup target add ${rustTarget}`);
    }
  }
}

function preflightReleaseSigning() {
  const required = [
    "MISTY_ANDROID_KEYSTORE_FILE",
    "MISTY_ANDROID_KEYSTORE_PASSWORD",
    "MISTY_ANDROID_KEY_ALIAS",
    "MISTY_ANDROID_KEY_PASSWORD",
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    fail([
      "Android release signing is not configured.",
      `Missing: ${missing.join(", ")}`,
      "Set these variables before building a Google Play release APK/AAB.",
      "If Google Play App Signing is enabled, this should be your upload key keystore.",
    ].join("\n"));
  }
  requirePath(process.env.MISTY_ANDROID_KEYSTORE_FILE, "Android upload keystore", "Generate or supply the Play upload keystore file.");
  validateSigningKey();
}

function validateSigningKey() {
  const keytool = resolve(javaHome, "bin/keytool");
  requirePath(keytool, "JDK keytool", "Set JAVA_HOME to a JDK that includes keytool.");
  const result = spawnSync(keytool, [
    "-list",
    "-keystore", process.env.MISTY_ANDROID_KEYSTORE_FILE,
    "-storepass", process.env.MISTY_ANDROID_KEYSTORE_PASSWORD,
    "-alias", process.env.MISTY_ANDROID_KEY_ALIAS,
  ], {
    cwd: appDir,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    fail("Android signing key could not be loaded. Check MISTY_ANDROID_KEYSTORE_PASSWORD and MISTY_ANDROID_KEY_ALIAS.");
  }
}

function cleanAndroidOutputs() {
  const androidProject = resolve(appDir, "src-tauri/gen/android");
  const gradlew = resolve(androidProject, "gradlew");
  requirePath(gradlew, "Android Gradle wrapper", "Regenerate the Android project with Tauri before building a release.");
  run(gradlew, ["clean"], {}, androidProject);
}

function loadSigningEnvironment() {
  if (!existsSync(signingEnvFile)) return;

  const allowed = new Set([
    "MISTY_ANDROID_KEYSTORE_FILE",
    "MISTY_ANDROID_KEYSTORE_PASSWORD",
    "MISTY_ANDROID_KEY_ALIAS",
    "MISTY_ANDROID_KEY_PASSWORD",
  ]);

  for (const [index, rawLine] of readFileSync(signingEnvFile, "utf8").split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = rawLine.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) {
      fail(`Invalid signing environment entry in ${signingEnvFile}:${index + 1}. Use KEY=value.`);
    }

    const [, name, rawValue] = match;
    if (!allowed.has(name)) {
      fail(`Unsupported signing environment variable in ${signingEnvFile}:${index + 1}: ${name}`);
    }

    process.env[name] = parseEnvironmentValue(rawValue);
  }
}

function parseEnvironmentValue(rawValue) {
  const value = rawValue.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function requirePath(pathValue, label, hint) {
  if (!pathValue || !existsSync(pathValue)) {
    fail(`${label} not found: ${pathValue || "(unset)"}\n${hint}`);
  }
}

function run(command, commandArgs, env = {}, cwd = appDir) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      ANDROID_HOME: sdk,
      ANDROID_SDK_ROOT: sdk,
      JAVA_HOME: javaHome,
      PATH: `${resolve(sdk, "platform-tools")}:${resolve(sdk, "emulator")}:${resolve(sdk, "cmdline-tools/latest/bin")}:${process.env.PATH ?? ""}`,
      ...env,
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runCapture(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: appDir,
    encoding: "utf8",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(`${command} ${commandArgs.join(" ")} failed:\n${result.stderr}`);
  }
  return result.stdout;
}

function androidCargoTarget(target) {
  return {
    "android-arm64": "aarch64",
    "android-armv7": "armv7",
    "android-x86": "i686",
    "android-x86_64": "x86_64",
  }[target] ?? fail(`Unsupported Android target: ${target}`);
}

function rustTargetFor(target) {
  return {
    "android-arm64": "aarch64-linux-android",
    "android-armv7": "armv7-linux-androideabi",
    "android-x86": "i686-linux-android",
    "android-x86_64": "x86_64-linux-android",
  }[target] ?? fail(`Unsupported Android target: ${target}`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
