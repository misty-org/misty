import type { InstallCheck, InstallerStatus, MistyTemplateEntry, MistyTemplateStatus, NativeSystemInfo, PathProbe } from "../models/setup";

export const browserTemplateEntries: MistyTemplateEntry[] = [
  templateEntry("dir", ".local"),
  templateEntry("dir", ".local/bin"),
  templateEntry("file", ".local/bin/misty"),
  templateEntry("dir", "assets"),
  templateEntry("dir", "scripts"),
  templateEntry("dir", "plugins/public"),
  templateEntry("dir", "plugins/private"),
  templateEntry("dir", "config"),
  templateEntry("dir", "config/sessions"),
  templateEntry("dir", "db"),
  templateEntry("dir", "forms"),
  templateEntry("dir", "rclone"),
  templateEntry("dir", "tmp"),
  templateEntry("dir", "tmp/transfers"),
  templateEntry("dir", "tmp/downloads"),
  templateEntry("dir", ".cache"),
  templateEntry("dir", ".cache/trash"),
  templateEntry("dir", ".cache/remotes"),
  templateEntry("dir", ".cache/sessions"),
  templateEntry("dir", "mnt"),
];

export function mistyPath(home: string, relativePath: string) {
  return `${home.replace(/\/+$/, "")}/${relativePath.replace(/^\/+/, "")}`;
}

export function executableNameForOs(os: string, binary: string) {
  return os === "windows" ? `${binary}.exe` : binary;
}

export function buildInstallerStatusFromTemplate(
  native: NativeSystemInfo,
  template: MistyTemplateStatus,
  setupProbe?: PathProbe,
): InstallerStatus {
  const checks = template.entries.map(templateCheck);
  const folders = checks.filter((check) => check.kind === "dir");
  const binaries = checks.filter((check) => check.kind === "file");

  const setupUpdate: InstallCheck = {
    name: "Misty installer",
    path: native.setup_path,
    required: false,
    exists: Boolean(setupProbe?.is_file || setupProbe?.exists),
    status: "pending",
    message: setupProbe?.exists
      ? "Installer update check is not connected yet."
      : "Installer app path could not be verified.",
  };

  return {
    os: native.os,
    arch: native.arch,
    misty_home: native.misty_home,
    install_dir: native.install_dir,
    legacy_install_dir: native.legacy_install_dir,
    db_path: native.db_path,
    installed_version: native.installed_version,
    current_user: native.current_user,
    current_license: native.current_license,
    ready: [...folders, ...binaries].every((check) => !check.required || check.exists),
    folders,
    binaries,
    setup_update: setupUpdate,
  };
}

function templateCheck(entry: MistyTemplateEntry): InstallCheck {
  const label = entry.kind === "dir" ? "Folder" : "File";
  return {
    name: entry.relativePath,
    path: entry.path,
    sourcePath: entry.sourcePath,
    kind: entry.kind,
    required: entry.required,
    exists: entry.exists,
    status: entry.exists ? "ready" : "missing",
    message: entry.exists ? `${label} is ready.` : `${label} will be restored from the Misty template.`,
  };
}

function templateEntry(kind: "dir" | "file", relativePath: string): MistyTemplateEntry {
  return {
    relativePath,
    path: `~/.misty/${relativePath}`,
    sourcePath: null,
    kind,
    required: true,
    exists: false,
  };
}
