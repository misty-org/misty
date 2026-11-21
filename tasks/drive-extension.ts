import { execFileSync } from "node:child_process";
import { constants, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The File Provider extension that puts each Space in Finder (`src-tauri/features/space_drive_extension`).
// Tauri can't bundle an app extension, and its signer skips `.appex`, so this builds the extension's Rust
// binary, assembles `MistyDrive.appex`, and signs it with its own entitlements before the app around it is
// signed. Release builds run it as Tauri's `beforeBundleCommand` (`tauri.macos.conf.json` maps the result into
// `Contents/PlugIns`); dev builds call `prepareDevelopmentExtension` from the signed dev runner.

const SOURCE = fileURLToPath(new URL("../src-tauri/", import.meta.url));
/** Everything this task makes, under Cargo's target folder so it never lands in the repository. */
export const OUTPUT = join(SOURCE, "target", "drive-extension");
export const EXTENSION_NAME = "MistyDrive";
export const EXTENSION_EXECUTABLE = "misty-drive-ext";
/** The Objective-C class the extension registers from Rust; `NSExtensionPrincipalClass` names it. */
export const PRINCIPAL_CLASS = "MistyDriveExtension";

/** An extension's bundle id must start with its app's. Dev and release differ, so their domains never mix. */
export function extensionBundleId(release: boolean): string {
  return release ? "com.misty.desktop.drive" : "com.misty.desktop.drivedev";
}

/**
 * The app group Misty and its extension share (`~/Library/Group Containers/<group>`, where the drive's socket
 * lives). A Team ID prefix needs no provisioning profile on macOS. Native code works out the same name at
 * runtime from its own code signature (`space_drive` and the extension), so the two always agree.
 */
export function appGroup(teamId: string, release: boolean): string {
  if (!/^[A-Z0-9]{10}$/.test(teamId)) throw new Error(`Not an Apple Team ID: ${teamId}`);
  return `${teamId}.com.misty.desktop${release ? "" : ".dev"}`;
}

/** `CFBundleShortVersionString` takes numbers only: "0.1.0-beta.1" is "0.1.0". */
export function bundleVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) throw new Error(`Misty's version isn't x.y.z: ${version}`);
  return `${match[1]}.${match[2]}.${match[3]}`;
}

/** The Team ID in a certificate subject printed by `openssl x509 -subject -nameopt RFC2253`. */
export function teamIdFromSubject(subject: string): string | undefined {
  return /(?:^|[,/=\s])OU=([A-Z0-9]{10})(?:[,/]|$)/m.exec(subject.trim())?.[1];
}

/** The PEM of the certificate whose SHA-1 is `hash`, from `security find-certificate -a -Z -p`. */
export function certificateForHash(listing: string, hash: string): string | undefined {
  // Each certificate's hashes come just before its PEM, so the first PEM after the hash line is its own.
  const at = listing.toUpperCase().indexOf(`SHA-1 HASH: ${hash.toUpperCase()}`);
  if (at < 0) return undefined;
  return /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/.exec(listing.slice(at))?.[0];
}

/** The Team ID of a signing identity, given as its SHA-1 or its exact name. */
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

/**
 * The targets to build the extension for: the one Tauri bundles (`TAURI_ENV_TARGET_TRIPLE`, which Tauri sets for
 * its before-commands), or both Mac architectures for a universal app or when Tauri didn't say.
 */
export function extensionTargets(triple: string | undefined): string[] {
  const both = ["aarch64-apple-darwin", "x86_64-apple-darwin"];
  return triple && both.includes(triple) ? [triple] : both;
}

/** Builds the extension's binary (as the app's targets for release) and returns its path. */
export function buildExtensionBinary(release: boolean, triple?: string): string {
  const manifest = join(SOURCE, "features", "space_drive_extension", "Cargo.toml");
  // A target folder of its own: the dev runner calls this while the app's own `cargo run` holds the main one.
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

/** `MistyDrive.appex` at `into`, holding `binary`. Returns the bundle's path. */
export function assembleExtension(options: {
  binary: string;
  into: string;
  release: boolean;
  version: string;
  /** The app group the extension shares with Misty, which File Provider takes as its document group. */
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
    // PlugInKit refuses an extension packaged as an application.
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

/** The extension runs sandboxed, reaching only the app group, where Misty's socket is. */
export function writeExtensionEntitlements(path: string, group: string | undefined) {
  writePlist(path, {
    "com.apple.security.app-sandbox": true,
    ...(group ? { "com.apple.security.application-groups": [group] } : {}),
  });
}

/** Misty's own entitlements (`packaging/Entitlements.plist`) plus the app group it shares. */
export function writeAppEntitlements(path: string, group: string | undefined) {
  const base = readPlist(join(SOURCE, "packaging", "Entitlements.plist"));
  writePlist(path, {
    ...base,
    ...(group ? { "com.apple.security.application-groups": [group] } : {}),
  });
}

/** Signs the extension with its own entitlements; `-` signs ad hoc, which macOS won't load. */
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

/**
 * Release: builds and signs `target/drive-extension/MistyDrive.appex` and writes `Misty.entitlements` beside it,
 * both of which `tauri.macos.conf.json` points the bundler at. The identity and Team ID come from the same
 * environment Tauri signs with (`APPLE_SIGNING_IDENTITY`, `APPLE_TEAM_ID`). Without an identity both are made
 * ad hoc, so the bundle still builds; such a build can't start Space drives, and Misty says so.
 */
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

/**
 * Dev: builds the extension, puts it in the dev bundle's `Contents/PlugIns` and signs it with the dev identity.
 * Returns the extension and the entitlements the dev bundle itself must be signed with, so both share the
 * app group.
 */
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

/**
 * Tells PlugInKit about a dev build's extension, which lives in a bundle LaunchServices may not have seen
 * yet, so the system finds it when Misty adds the account's drive. Run after the bundle is signed.
 */
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
