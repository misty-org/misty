import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const args = process.argv.slice(2);
const isDevice = args.includes("--device");
const isBuild = args.includes("--build");
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
