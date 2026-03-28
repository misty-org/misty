import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const proxyDir = resolve(appDir, "../misty-proxy");
const target = process.env.MISTY_PROXY_GO_TARGET ?? "host";
const outDir =
  process.env.MISTY_PROXY_GO_OUT_DIR ??
  resolve(appDir, "src-tauri/target/misty-proxy", target);
const libName = process.env.MISTY_PROXY_GO_LIB_NAME ?? "misty_proxy";
const env = {
  ...process.env,
  ...targetEnvironment(target),
  MISTY_PROXY_GO_TARGET: target,
  MISTY_PROXY_GO_OUT_DIR: outDir,
  MISTY_PROXY_GO_LIB_NAME: libName,
};
const isAndroid = target.startsWith("android-");
const isWindowsHost = target === "host" && process.platform === "win32";
const outputName = isAndroid
  ? `lib${libName}.so`
  : isWindowsHost
    ? `${libName}.dll`
    : `lib${libName}.a`;

mkdirSync(outDir, { recursive: true });

const result = spawnSync(
  "go",
  [
    "build",
    "-tags",
    "misty_carchive",
    `-buildmode=${isAndroid || isWindowsHost ? "c-shared" : "c-archive"}`,
    "-trimpath",
    "-ldflags=-s -w",
    "-o",
    join(outDir, outputName),
    ".",
  ],
  {
    cwd: proxyDir,
    stdio: "inherit",
    shell: false,
    env,
  },
);

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
if (isAndroid) {
  copyAndroidSharedLibrary(target, join(outDir, outputName));
}
process.exit(0);

function targetEnvironment(target) {
  if (target.startsWith("android-")) {
    return androidEnvironment(target);
  }
  if (target.startsWith("ios-")) {
    return iosEnvironment(target);
  }
  return { CGO_ENABLED: "1" };
}

function androidEnvironment(target) {
  const sdk =
    process.env.ANDROID_HOME ??
    process.env.ANDROID_SDK_ROOT ??
    (process.env.LOCALAPPDATA
      ? resolve(process.env.LOCALAPPDATA, "Android/Sdk")
      : undefined);
  if (!sdk || !existsSync(sdk)) {
    throw new Error("Android SDK not found. Set ANDROID_HOME or ANDROID_SDK_ROOT.");
  }

  const ndk = androidNdk(sdk);
  const cc = androidCompiler(ndk, target);
  const env = {
    ANDROID_HOME: sdk,
    ANDROID_SDK_ROOT: sdk,
    ANDROID_NDK_HOME: ndk,
    ANDROID_NDK_ROOT: ndk,
    CC: cc,
    CGO_ENABLED: "1",
  };

  switch (target) {
    case "android-arm64":
      return { ...env, GOOS: "android", GOARCH: "arm64" };
    case "android-armv7":
      return { ...env, GOOS: "android", GOARCH: "arm", GOARM: "7" };
    case "android-x86":
      return { ...env, GOOS: "android", GOARCH: "386" };
    case "android-x86_64":
      return { ...env, GOOS: "android", GOARCH: "amd64" };
    default:
      throw new Error(`Unsupported Android target: ${target}`);
  }
}

function androidNdk(sdk) {
  const explicitNdk =
    process.env.ANDROID_NDK_HOME ??
    process.env.ANDROID_NDK_ROOT ??
    process.env.NDK_HOME;
  if (explicitNdk && existsSync(explicitNdk)) {
    return explicitNdk;
  }

  const ndkRoot = resolve(sdk, "ndk");
  if (existsSync(ndkRoot)) {
    const versions = readdirSync(ndkRoot)
      .map((name) => resolve(ndkRoot, name))
      .filter((entry) => existsSync(entry))
      .sort(versionCompare);
    const latest = versions.at(-1);
    if (latest) {
      return latest;
    }
  }
  throw new Error("Android NDK not found. Install it in Android Studio or set ANDROID_NDK_HOME.");
}

function androidCompiler(ndk, target) {
  const api = process.env.ANDROID_API_LEVEL ?? "28";
  const hostTag = androidHostTag();
  const suffix = process.platform === "win32" ? ".cmd" : "";
  const triples = {
    "android-arm64": "aarch64-linux-android",
    "android-armv7": "armv7a-linux-androideabi",
    "android-x86": "i686-linux-android",
    "android-x86_64": "x86_64-linux-android",
  };
  const triple = triples[target];
  if (!triple) {
    throw new Error(`Unsupported Android target: ${target}`);
  }
  return resolve(
    ndk,
    "toolchains/llvm/prebuilt",
    hostTag,
    "bin",
    `${triple}${api}-clang${suffix}`,
  );
}

function copyAndroidSharedLibrary(target, source) {
  const abi = {
    "android-arm64": "arm64-v8a",
    "android-armv7": "armeabi-v7a",
    "android-x86": "x86",
    "android-x86_64": "x86_64",
  }[target];
  if (!abi) {
    return;
  }
  const destinationDir = resolve(
    appDir,
    "src-tauri/gen/android/app/src/main/jniLibs",
    abi,
  );
  mkdirSync(destinationDir, { recursive: true });
  copyFileSync(source, join(destinationDir, "libmisty_proxy.so"));
}

function androidHostTag() {
  switch (process.platform) {
    case "darwin":
      return "darwin-x86_64";
    case "linux":
      return "linux-x86_64";
    case "win32":
      return "windows-x86_64";
    default:
      throw new Error(`Unsupported Android build host: ${process.platform}`);
  }
}

function iosEnvironment(target) {
  const simulator = target.startsWith("ios-simulator-");
  const sdk = simulator ? "iphonesimulator" : "iphoneos";
  const arch = target.endsWith("amd64") ? "x86_64" : "arm64";
  const sdkPath = commandOutput("xcrun", ["--sdk", sdk, "--show-sdk-path"]);
  const clang = commandOutput("xcrun", ["--sdk", sdk, "--find", "clang"]);
  const minFlag = simulator
    ? "-mios-simulator-version-min=15.0"
    : "-miphoneos-version-min=15.0";
  return {
    GOOS: "ios",
    GOARCH: arch === "x86_64" ? "amd64" : "arm64",
    CGO_ENABLED: "1",
    CC: clang,
    CGO_CFLAGS: `-isysroot ${sdkPath} ${minFlag} -arch ${arch} ${process.env.CGO_CFLAGS ?? ""}`.trim(),
    CGO_LDFLAGS: `-isysroot ${sdkPath} ${minFlag} -arch ${arch} ${process.env.CGO_LDFLAGS ?? ""}`.trim(),
  };
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function versionCompare(left, right) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}
