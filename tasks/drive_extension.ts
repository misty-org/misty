import { execFileSync } from "node:child_process";
import { constants, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = fileURLToPath(new URL("../src-tauri/", import.meta.url));
export const OUTPUT = join(SOURCE, "target", "drive-extension");
export const EXTENSION_NAME = "MistyDrive";
export const EXTENSION_EXECUTABLE = "misty-drive-ext";
export const PRINCIPAL_CLASS = "MistyDriveExtension";

export function extensionBundleId(release: boolean): string {
  return release ? "com.misty.desktop.drive" : "com.misty.desktop.drivedev";
}

export function appGroup(teamId: string, release: boolean): string {
  if (!/^[A-Z0-9]{10}$/.test(teamId)) throw new Error(`Not an Apple Team ID: ${teamId}`);
  return `${teamId}.com.misty.desktop${release ? "" : ".dev"}`;
}

export function bundleVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) throw new Error(`Misty's version isn't x.y.z: ${version}`);
  return `${match[1]}.${match[2]}.${match[3]}`;
}

export function teamIdFromSubject(subject: string): string | undefined {
  return /(?:^|[,/=\s])OU=([A-Z0-9]{10})(?:[,/]|$)/m.exec(subject.trim())?.[1];
}

export function certificateForHash(listing: string, hash: string): string | undefined {
  const at = listing.toUpperCase().indexOf(`SHA-1 HASH: ${hash.toUpperCase()}`);
  if (at < 0) return undefined;
  return /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/.exec(listing.slice(at))?.[0];
}

export function teamIdForIdentity(identity: string): string {
  const pem = /^[A-Fa-f0-9]{40}$/.test(identity)
    ? certificateForHash(
        execFileSync("/usr/bin/security", ["find-certificate", "-a", "-Z", "-p"], {
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
        }),
        identity,
      )
    : execFileSync("/usr/bin/security", ["find-certificate", "-c", identity, "-p"], {
        encoding: "utf8",
      }).trim() || undefined;
  if (!pem) throw new Error(`No certificate found for the signing identity ${identity}`);
  const subject = execFileSync("/usr/bin/openssl", ["x509", "-noout", "-subject", "-nameopt", "RFC2253"], {
    input: pem,
    encoding: "utf8",
  });
  const team = teamIdFromSubject(subject);
  if (!team) throw new Error(`The signing identity ${identity} has no Team ID`);
  return team;
}

function hostTarget(): string {
  return process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
}

export function extensionTargets(triple: string | undefined): string[] {
  const both = ["aarch64-apple-darwin", "x86_64-apple-darwin"];
  return triple && both.includes(triple) ? [triple] : both;
}

export function buildExtensionBinary(release: boolean, triple?: string): string {
  const manifest = join(SOURCE, "features", "space_drive_extension", "Cargo.toml");
  const targetDir = join(OUTPUT, "cargo");
  const targets = release ? extensionTargets(triple) : [hostTarget()];
  const profile = release ? "release" : "debug";
  for (const target of targets) {
    execFileSync(
      "cargo",
      [
        "build",
        "--manifest-path",
        manifest,
        "--target-dir",
        targetDir,
        "--target",
        target,
        ...(release ? ["--release"] : []),
      ],
      { stdio: "inherit" },
    );
  }
  const built = targets.map((target) => join(targetDir, target, profile, EXTENSION_EXECUTABLE));
  const binary = join(OUTPUT, EXTENSION_EXECUTABLE);
  mkdirSync(OUTPUT, { recursive: true });
  if (built.length > 1) {
    execFileSync("/usr/bin/lipo", ["-create", "-output", binary, ...built], { stdio: "inherit" });
  } else {
    copyFileSync(built[0], binary, constants.COPYFILE_FICLONE);
  }
  return binary;
}

function writePlist(path: string, value: unknown) {
  execFileSync("/usr/bin/plutil", ["-convert", "xml1", "-o", path, "-"], {
    input: JSON.stringify(value),
  });
}

function readPlist(path: string): Record<string, unknown> {
  return JSON.parse(
    execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", path], { encoding: "utf8" }),
  );
}

export function assembleExtension(options: {
  binary: string;
  into: string;
  release: boolean;
  version: string;
  group: string | undefined;
}): string {
  const appex = join(options.into, `${EXTENSION_NAME}.appex`);
  rmSync(appex, { recursive: true, force: true });
  const contents = join(appex, "Contents");
  mkdirSync(join(contents, "MacOS"), { recursive: true });
  copyFileSync(options.binary, join(contents, "MacOS", EXTENSION_EXECUTABLE), constants.COPYFILE_FICLONE);
  const version = bundleVersion(options.version);
  writePlist(join(contents, "Info.plist"), {
    CFBundleDevelopmentRegion: "en",
    CFBundleDisplayName: "Misty",
    CFBundleExecutable: EXTENSION_EXECUTABLE,
    CFBundleIdentifier: extensionBundleId(options.release),
    CFBundleInfoDictionaryVersion: "6.0",
    CFBundleName: EXTENSION_NAME,
    CFBundlePackageType: "XPC!",
    CFBundleShortVersionString: version,
    CFBundleVersion: version,
    LSMinimumSystemVersion: "14.0",
    NSExtension: {
      NSExtensionPointIdentifier: "com.apple.fileprovider-nonui",
      NSExtensionPrincipalClass: PRINCIPAL_CLASS,
      NSExtensionFileProviderSupportsEnumeration: true,
      ...(options.group ? { NSExtensionFileProviderDocumentGroup: options.group } : {}),
    },
  });
  return appex;
}

export function writeExtensionEntitlements(path: string, group: string | undefined) {
  writePlist(path, {
    "com.apple.security.app-sandbox": true,
    ...(group ? { "com.apple.security.application-groups": [group] } : {}),
  });
}

export function writeAppEntitlements(path: string, group: string | undefined) {
  const base = readPlist(join(SOURCE, "packaging", "Entitlements.plist"));
  writePlist(path, {
    ...base,
    ...(group ? { "com.apple.security.application-groups": [group] } : {}),
  });
}

export function signExtension(appex: string, identity: string, entitlements: string, release: boolean) {
  execFileSync(
    "/usr/bin/codesign",
    [
      "--force",
      "--sign",
      identity,
      "--entitlements",
      entitlements,
      ...(release && identity !== "-" ? ["--options", "runtime", "--timestamp"] : ["--timestamp=none"]),
      appex,
    ],
    { stdio: "inherit" },
  );
  execFileSync("/usr/bin/codesign", ["--verify", "--strict", appex], { stdio: "inherit" });
}

function mistyVersion(): string {
  const config = JSON.parse(readFileSync(join(SOURCE, "tauri.conf.json"), "utf8")) as { version: string };
  return config.version;
}

export function prepareReleaseExtension(environment = process.env) {
  const identity = environment.APPLE_SIGNING_IDENTITY?.trim() || "-";
  const team =
    environment.APPLE_TEAM_ID?.trim() || (identity === "-" ? undefined : teamIdForIdentity(identity));
  const group = team ? appGroup(team, true) : undefined;
  const binary = buildExtensionBinary(true, environment.TAURI_ENV_TARGET_TRIPLE?.trim());
  const appex = assembleExtension({ binary, into: OUTPUT, release: true, version: mistyVersion(), group });
  const extensionEntitlements = join(OUTPUT, `${EXTENSION_NAME}.entitlements`);
  writeExtensionEntitlements(extensionEntitlements, group);
  writeAppEntitlements(join(OUTPUT, "Misty.entitlements"), group);
  signExtension(appex, identity, extensionEntitlements, true);
}

export function prepareDevelopmentExtension(
  bundle: string,
  identity: string,
): { appex: string; entitlements: string } {
  const group = appGroup(teamIdForIdentity(identity), false);
  const binary = buildExtensionBinary(false);
  const plugins = join(bundle, "Contents", "PlugIns");
  mkdirSync(plugins, { recursive: true });
  const appex = assembleExtension({
    binary,
    into: plugins,
    release: false,
    version: mistyVersion(),
    group,
  });
  const extensionEntitlements = join(OUTPUT, `${EXTENSION_NAME}.dev.entitlements`);
  writeExtensionEntitlements(extensionEntitlements, group);
  signExtension(appex, identity, extensionEntitlements, false);
  const appEntitlements = join(OUTPUT, "Misty.dev.entitlements");
  writeAppEntitlements(appEntitlements, group);
  return { appex, entitlements: appEntitlements };
}

export function registerDevelopmentExtension(appex: string) {
  execFileSync("/usr/bin/pluginkit", ["-a", appex], { stdio: "inherit" });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.platform === "darwin") prepareReleaseExtension();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
