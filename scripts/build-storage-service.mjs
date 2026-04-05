import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serviceDir = resolve(appDir, "service");
const submoduleDir = resolve(serviceDir, "rclone");
const patchesDir = resolve(serviceDir, "patches");
const stagedSourceDir = resolve(appDir, "src-tauri/target/misty-service/source");
const sourceStampPath = join(stagedSourceDir, ".misty-source-version");
const expectedRcloneCommit = "5bc93a2a7ab0ebd0a11352bc4968eabeffb18027";
const target = process.env.MISTY_SERVICE_GO_TARGET ?? "host";
const outDir = process.env.MISTY_SERVICE_GO_OUT_DIR ?? resolve(appDir, "src-tauri/target/misty-service", target);
const libName = "misty_service";
const env = { ...process.env, ...targetEnvironment(target) };
const isAndroid = target.startsWith("android-");
const isWindowsHost = target === "host" && process.platform === "win32";
const outputName = isAndroid ? `lib${libName}.so` : isWindowsHost ? `${libName}.dll` : `lib${libName}.a`;

preparePatchedSource();
mkdirSync(outDir, { recursive: true });
const result = spawnSync("go", [
  "build",
  `-buildmode=${isAndroid || isWindowsHost ? "c-shared" : "c-archive"}`,
  "-trimpath",
  "-ldflags=-s -w",
  "-o",
  join(outDir, outputName),
  "./librclone",
], { cwd: stagedSourceDir, stdio: "inherit", shell: false, env });

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
if (isAndroid) copyAndroidSharedLibrary(target, join(outDir, outputName));

function preparePatchedSource() {
  if (!existsSync(join(submoduleDir, "go.mod"))) {
    throw new Error(
      "The rclone submodule is not initialized. Run: git submodule update --init --recursive",
    );
  }
  const commit = commandOutput("git", ["-C", submoduleDir, "rev-parse", "HEAD"]);
  if (commit !== expectedRcloneCommit) {
    throw new Error(`Expected rclone ${expectedRcloneCommit}, found ${commit}. Run git submodule update --init --recursive.`);
  }
  const patchFiles = readdirSync(patchesDir)
    .filter((name) => name.endsWith(".patch"))
    .sort()
    .map((name) => resolve(patchesDir, name));
  const sourceVersion = createHash("sha256")
    .update(commit)
    .update(patchFiles.map((file) => readFileSync(file)).join(""))
    .digest("hex");
  if (
    existsSync(join(stagedSourceDir, "go.mod")) &&
    readText(sourceStampPath) === sourceVersion
  ) {
    return;
  }

  rmSync(stagedSourceDir, { recursive: true, force: true });
  mkdirSync(dirname(stagedSourceDir), { recursive: true });
  cpSync(submoduleDir, stagedSourceDir, {
    recursive: true,
    filter: (source) => basename(source) !== ".git",
  });
  for (const patchFile of patchFiles) {
    runChecked("git", ["apply", "--check", patchFile], stagedSourceDir);
    runChecked("git", ["apply", patchFile], stagedSourceDir);
  }
  writeFileSync(sourceStampPath, `${sourceVersion}\n`);
}

function readText(path) {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

function runChecked(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function targetEnvironment(target) {
  if (target.startsWith("android-")) return androidEnvironment(target);
  if (target.startsWith("ios-")) return iosEnvironment(target);
  return { CGO_ENABLED: "1" };
}

function androidEnvironment(target) {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ??
    (process.platform === "darwin" && process.env.HOME ? resolve(process.env.HOME, "Library/Android/sdk") : undefined) ??
    (process.env.LOCALAPPDATA ? resolve(process.env.LOCALAPPDATA, "Android/Sdk") : undefined);
  if (!sdk || !existsSync(sdk)) throw new Error("Android SDK not found. Set ANDROID_HOME or ANDROID_SDK_ROOT.");
  const ndk = androidNdk(sdk);
  const env = {
    ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, ANDROID_NDK_HOME: ndk, ANDROID_NDK_ROOT: ndk,
    CC: androidCompiler(ndk, target), CGO_ENABLED: "1",
  };
  switch (target) {
    case "android-arm64": return { ...env, GOOS: "android", GOARCH: "arm64" };
    case "android-armv7": return { ...env, GOOS: "android", GOARCH: "arm", GOARM: "7" };
    case "android-x86": return { ...env, GOOS: "android", GOARCH: "386" };
    case "android-x86_64": return { ...env, GOOS: "android", GOARCH: "amd64" };
    default: throw new Error(`Unsupported Android target: ${target}`);
  }
}

function androidNdk(sdk) {
  const explicit = process.env.ANDROID_NDK_HOME ?? process.env.ANDROID_NDK_ROOT ?? process.env.NDK_HOME;
  if (explicit && existsSync(explicit)) return explicit;
  const root = resolve(sdk, "ndk");
  if (existsSync(root)) {
    const latest = readdirSync(root).map((name) => resolve(root, name)).filter(existsSync)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
    if (latest) return latest;
  }
  throw new Error("Android NDK not found.");
}

function androidCompiler(ndk, target) {
  const triples = {
    "android-arm64": "aarch64-linux-android", "android-armv7": "armv7a-linux-androideabi",
    "android-x86": "i686-linux-android", "android-x86_64": "x86_64-linux-android",
  };
  const triple = triples[target];
  if (!triple) throw new Error(`Unsupported Android target: ${target}`);
  const host = process.platform === "darwin" ? "darwin-x86_64" : process.platform === "linux" ? "linux-x86_64" : "windows-x86_64";
  const suffix = process.platform === "win32" ? ".cmd" : "";
  return resolve(ndk, "toolchains/llvm/prebuilt", host, "bin", `${triple}${process.env.ANDROID_API_LEVEL ?? "28"}-clang${suffix}`);
}

function copyAndroidSharedLibrary(target, source) {
  const abi = { "android-arm64": "arm64-v8a", "android-armv7": "armeabi-v7a", "android-x86": "x86", "android-x86_64": "x86_64" }[target];
  if (!abi) return;
  const destination = resolve(appDir, "src-tauri/gen/android/app/src/main/jniLibs", abi);
  mkdirSync(destination, { recursive: true });
  copyFileSync(source, join(destination, "libmisty_service.so"));
}

function iosEnvironment(target) {
  const simulator = target.startsWith("ios-simulator-");
  const sdk = simulator ? "iphonesimulator" : "iphoneos";
  const arch = target.endsWith("amd64") ? "x86_64" : "arm64";
  const sdkPath = commandOutput("xcrun", ["--sdk", sdk, "--show-sdk-path"]);
  const clang = commandOutput("xcrun", ["--sdk", sdk, "--find", "clang"]);
  const minimum = simulator ? "-mios-simulator-version-min=15.0" : "-miphoneos-version-min=15.0";
  return {
    GOOS: "ios", GOARCH: arch === "x86_64" ? "amd64" : "arm64", CGO_ENABLED: "1", CC: clang,
    CGO_CFLAGS: `-isysroot ${sdkPath} ${minimum} -arch ${arch} ${process.env.CGO_CFLAGS ?? ""}`.trim(),
    CGO_LDFLAGS: `-isysroot ${sdkPath} ${minimum} -arch ${arch} ${process.env.CGO_LDFLAGS ?? ""}`.trim(),
  };
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}
