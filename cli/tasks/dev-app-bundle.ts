import { execFileSync } from "node:child_process";
import { constants, copyFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// A window title does not name a Dock item. Give the dev executable a real
// bundle, with one stable path per profile, so macOS can resolve its app name.
export function prepareDevelopmentBundle(binary: string, profile?: string) {
  if (profile !== undefined && !/^[a-z0-9-]{1,32}$/.test(profile)) {
    throw new Error("Invalid desktop development profile name.");
  }
  const name = profile ?? "Misty";
  const bundle = join(dirname(binary), "misty-dev-apps", `${name}.app`);
  const contents = join(bundle, "Contents");
  const executable = join(contents, "MacOS", "misty-desktop");
  const resources = join(contents, "Resources");
  mkdirSync(dirname(executable), { recursive: true });
  mkdirSync(resources, { recursive: true });

  // Copy instead of linking: signing or rebuilding one profile must not mutate
  // another running profile's executable. Rename avoids writing a running file.
  const temporary = `${executable}.${process.pid}.tmp`;
  copyFileSync(binary, temporary, constants.COPYFILE_FICLONE);
  renameSync(temporary, executable);
  const source = fileURLToPath(new URL("../../src-tauri/", import.meta.url));
  copyFileSync(join(source, "icons", "icon.icns"), join(resources, "icon.icns"));
  const info = JSON.parse(
    execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", join(source, "Info.plist")], {
      encoding: "utf8",
    }),
  );
  Object.assign(info, {
    CFBundleName: name,
    CFBundleDisplayName: name,
    CFBundleExecutable: "misty-desktop",
    CFBundleIdentifier: profile ? `com.misty.desktop.${profile}` : "com.misty.desktop",
    CFBundlePackageType: "APPL",
    CFBundleInfoDictionaryVersion: "6.0",
    CFBundleVersion: "1",
    CFBundleShortVersionString: "0.1.0",
    CFBundleIconFile: "icon.icns",
    NSHighResolutionCapable: true,
  });
  execFileSync("/usr/bin/plutil", ["-convert", "xml1", "-o", join(contents, "Info.plist"), "-"], {
    input: JSON.stringify(info),
  });
  writeFileSync(join(contents, "PkgInfo"), "APPL????");
  return { bundle, executable };
}
