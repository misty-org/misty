import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
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

const androidSdk = resolveAndroidSdk();
const adbPath = androidSdk ? resolve(androidSdk, "platform-tools/adb") : null;
const physicalDevice = isDevice ? resolvePhysicalDevice(requestedDeviceId) : null;
const developmentPort = isDevice ? resolveDevelopmentPort() : 5173;
const developmentHost = isDevice ? resolveDevelopmentHost(physicalDevice, developmentPort) : null;
const accountApiProxyTarget = isDevice
  ? process.env.MISTY_ANDROID_ACCOUNT_API_PROXY?.trim() || null
  : null;
const deviceDevConfig = developmentHost
  ? JSON.stringify({ build: { devUrl: `http://${developmentHost}:${developmentPort}` } })
  : null;

const tauriArgs = isBuild
  ? ["run", "tauri", "--", "android", "build", "--apk"]
  : [
      "run",
      "tauri",
      "--",
      "android",
      "dev",
      ...(isDevice ? ["--host", developmentHost, "--config", deviceDevConfig] : ["--no-dev-server-wait"]),
    ];
if (isBuild && targetArg) {
  tauriArgs.push("--target", androidCargoTarget(targetArg));
}

run(npmCommand, tauriArgs, {
  ...(physicalDevice ? { ANDROID_SERIAL: physicalDevice } : {}),
  ...(developmentHost ? { TAURI_DEV_HOST: developmentHost } : {}),
  ...(isDevice ? { MISTY_DESKTOP_DEV_PORT: String(developmentPort) } : {}),
  ...(accountApiProxyTarget
    ? {
        MISTY_ACCOUNT_API_PROXY_TARGET: accountApiProxyTarget,
        MISTY_PUBLIC_API_URL: "/api",
      }
    : {}),
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
  if (!adbPath || !existsSync(adbPath)) {
    throw new Error("Android platform-tools were not found. Set ANDROID_HOME or install Android SDK platform-tools.");
  }

  const result = spawnSync(adbPath, ["devices"], {
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
    throw new Error(`Android device ${requestedId} is not connected and authorized. Run: ${adbPath} devices`);
  }
  if (physicalDevices.length === 1) return physicalDevices[0];
  if (physicalDevices.length === 0) {
    throw new Error(`No authorized physical Android device found. Connect and unlock the Lenovo, enable USB debugging, then confirm with: ${adbPath} devices`);
  }
  throw new Error(`Multiple physical Android devices found (${physicalDevices.join(", ")}). Re-run with --device-id=<serial>.`);
}

function resolveDevelopmentHost(deviceId, port) {
  if (process.env.MISTY_ANDROID_DEV_HOST) return process.env.MISTY_ANDROID_DEV_HOST;

  if (deviceId && adbPath && configureAdbReverse(deviceId, port)) {
    return "127.0.0.1";
  }

  if (process.platform === "darwin") {
    const defaultRoute = spawnSync("route", ["-n", "get", "default"], { encoding: "utf8" });
    const interfaceName = defaultRoute.stdout.match(/^\s*interface:\s*(\S+)\s*$/m)?.[1];
    if (interfaceName) {
      const address = spawnSync("ipconfig", ["getifaddr", interfaceName], { encoding: "utf8" });
      const host = address.stdout.trim();
      if (host) return host;
    }
  }

  const fallback = Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry && entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254."))
    ?.address;
  if (fallback) return fallback;
  throw new Error("Unable to determine the Mac's LAN address. Re-run with MISTY_ANDROID_DEV_HOST=<your-Mac-IP>.");
}

function resolveDevelopmentPort() {
  const raw = process.env.MISTY_ANDROID_DEV_PORT
    ?? process.env.MISTY_DESKTOP_DEV_PORT
    ?? "5174";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid Android development port: ${raw}`);
  }
  return port;
}

function resolveAndroidSdk() {
  return process.env.ANDROID_HOME
    ?? process.env.ANDROID_SDK_ROOT
    ?? (process.platform === "darwin" && process.env.HOME
      ? resolve(process.env.HOME, "Library/Android/sdk")
      : undefined);
}

function configureAdbReverse(deviceId, port) {
  const tcpPort = `tcp:${port}`;
  const result = spawnSync(adbPath, ["-s", deviceId, "reverse", tcpPort, tcpPort], {
    cwd: appDir,
    encoding: "utf8",
  });
  if (result.status === 0) return true;

  const details = (result.stderr || result.stdout || "").trim();
  if (details) {
    console.warn(`Unable to configure adb reverse for ${deviceId}: ${details}`);
  }
  return false;
}
