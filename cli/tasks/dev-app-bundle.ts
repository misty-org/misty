import { execFileSync } from "node:child_process";
import {
  constants,
  copyFileSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// A window title does not name a Dock item. Give the dev executable a real
// bundle, at one stable path, so macOS can resolve its app name.
export function prepareDevelopmentBundle(binary: string) {
  const name = "Misty";
  const bundle = join(dirname(binary), "misty-dev-apps", `${name}.app`);
  const contents = join(bundle, "Contents");
  const executable = join(contents, "MacOS", "misty-desktop");
  const resources = join(contents, "Resources");
  mkdirSync(dirname(executable), { recursive: true });
  mkdirSync(resources, { recursive: true });

  // A reload can kill an earlier run mid-copy. Its partial copy would sit in
  // Contents/MacOS, where codesign treats it as a broken subcomponent and
  // fails every later launch, so clear leftovers before copying.
  const prefix = `${basename(executable)}.`;
  for (const entry of readdirSync(dirname(executable))) {
    if (entry.startsWith(prefix) && entry.endsWith(".tmp")) {
      rmSync(join(dirname(executable), entry), { force: true });
    }
  }
  // Copy instead of linking: signing the bundle must not mutate the build output.
  // Rename avoids writing a running file.
  const temporary = `${executable}.${process.pid}.tmp`;
  try {
    copyFileSync(binary, temporary, constants.COPYFILE_FICLONE);
    renameSync(temporary, executable);
  } finally {
    rmSync(temporary, { force: true });
  }
  const source = fileURLToPath(new URL("../../src-tauri/", import.meta.url));
  copyFileSync(join(source, "icons", "icon.icns"), join(resources, "icon.icns"));
  const info = JSON.parse(
    execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", join(source, "packaging", "Info.plist")], {
      encoding: "utf8",
    }),
  );
  Object.assign(info, {
    CFBundleName: name,
    CFBundleDisplayName: name,
    CFBundleExecutable: "misty-desktop",
    CFBundleIdentifier: "com.misty.desktop",
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
