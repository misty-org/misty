import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const args = process.argv.slice(2);
const isDevice = args.includes("--device");
const isBuild = args.includes("--build");
const requestedDeviceId = args
  .find((arg) => arg.startsWith("--device-id="))
  ?.slice("--device-id=".length) ?? process.env.MISTY_ANDROID_DEVICE;
const targetArg = args
  .find((arg) => arg.startsWith("--target="))
  ?.slice("--target=".length);

const target =
  targetArg ??
  process.env.MISTY_PROXY_GO_TARGET ??
  (isDevice ? "android-arm64" : "android-x86_64");
const buildTargets = isBuild && !targetArg
  ? ["android-arm64", "android-armv7", "android-x86", "android-x86_64"]
  : [target];
const physicalDevice = isDevice ? resolvePhysicalDevice(requestedDeviceId) : null;

for (const buildTarget of buildTargets) {
  run(npmCommand, ["run", "proxy:archive"], {
    MISTY_PROXY_GO_TARGET: buildTarget,
    MISTY_PROXY_GO_LIB_NAME: "misty_proxy",
  });
}

const tauriArgs = isBuild
  ? ["run", "tauri", "--", "android", "build", "--apk"]
  : [
      "run",
      "tauri",
      "--",
      "android",
      "dev",
      ...(physicalDevice ? [physicalDevice] : []),
      isDevice ? "--host" : "--no-dev-server-wait",
    ];
if (isBuild && targetArg) {
  tauriArgs.push("--target", androidCargoTarget(targetArg));
}

run(npmCommand, [...tauriArgs, "--features=embedded-proxy-go"], {
  MISTY_PROXY_RUNTIME: "embedded",
  MISTY_RCLONE_BACKEND: "misty-rclone",
  MISTY_PROXY_GO_LIB_NAME: "misty_proxy",
});

function run(command, commandArgs, env = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: appDir,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      ...env,
    },
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function androidCargoTarget(target) {
  const targets = {
    "android-arm64": "aarch64",
    "android-armv7": "armv7",
    "android-x86": "i686",
    "android-x86_64": "x86_64",
  };
  const cargoTarget = targets[target];
  if (!cargoTarget) {
    throw new Error(`Unsupported Android target: ${target}`);
  }
  return cargoTarget;
}

function resolvePhysicalDevice(requestedId) {
  const sdk = process.env.ANDROID_HOME
    ?? process.env.ANDROID_SDK_ROOT
    ?? (process.platform === "darwin" && process.env.HOME
      ? resolve(process.env.HOME, "Library/Android/sdk")
      : undefined);
  const adb = sdk ? resolve(sdk, "platform-tools/adb") : null;
  if (!adb || !existsSync(adb)) {
    throw new Error("Android platform-tools were not found. Set ANDROID_HOME or install Android SDK platform-tools.");
  }

  const result = spawnSync(adb, ["devices"], {
    cwd: appDir,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Unable to list Android devices: ${result.stderr || result.stdout}`);
  }

  const physicalDevices = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, status]) => serial && status === "device" && !serial.startsWith("emulator-"))
    .map(([serial]) => serial);

  if (requestedId) {
    if (physicalDevices.includes(requestedId)) return requestedId;
    throw new Error(`Android device ${requestedId} is not connected and authorized. Run: ${adb} devices`);
  }
  if (physicalDevices.length === 1) return physicalDevices[0];
  if (physicalDevices.length === 0) {
    throw new Error(`No authorized physical Android device found. Connect and unlock the Lenovo, enable USB debugging, then confirm with: ${adb} devices`);
  }
  throw new Error(`Multiple physical Android devices found (${physicalDevices.join(", ")}). Re-run with --device-id=<serial>.`);
}
