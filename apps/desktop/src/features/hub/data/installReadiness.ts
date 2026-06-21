import type { InstallCheck, InstallerStatus, NativeSystemInfo, PathProbe } from "../types/setup";

export const requiredMistyFolders = [
  ".local/bin",
  "local/bin",
  "local/plugins",
  "assets",
  "assets/icons",
  "assets/logos",
  "assets/fonts",
  "assets/themes",
  "assets/animations",
  "assets/claude",
  "config",
  "config/sessions",
  "db",
  "plugins/public",
  "plugins/private",
  "public/plugins",
  "public/keys",
  "rclone",
  "restic/passwords",
  "tmp/transfers",
  "tmp/downloads",
  ".cache",
  ".cache/trash",
  ".cache/remotes",
  ".cache/sessions",
  "mnt",
  "forms",
  "scripts",
];

export const requiredMistyBinaries = ["misty", "misty-proxy"];

export function mistyPath(home: string, relativePath: string) {
  return `${home.replace(/\/+$/, "")}/${relativePath.replace(/^\/+/, "")}`;
}

export function executableNameForOs(os: string, binary: string) {
  return os === "windows" ? `${binary}.exe` : binary;
}

function normalizePath(path: string) {
  return path.replace(/\\/g, "/");
}

export function buildInstallerStatus(
  native: NativeSystemInfo,
  folderProbes: PathProbe[],
  binaryProbes: PathProbe[],
  setupProbe?: PathProbe,
): InstallerStatus {
  const folders = requiredMistyFolders.map((folder) => {
    const path = mistyPath(native.misty_home, folder);
    const probe = folderProbes.find((candidate) => normalizePath(candidate.path) === normalizePath(path));
    return buildCheck({
      name: folder,
      path,
      required: true,
      exists: Boolean(probe?.is_dir),
      readyMessage: "Folder is ready.",
      missingMessage: "Folder is missing.",
    });
  });

  const binaries = requiredMistyBinaries.map((binary) => {
    const executableName = executableNameForOs(native.os, binary);
    const path = mistyPath(native.install_dir, executableName);
    const probe = binaryProbes.find((candidate) => normalizePath(candidate.path) === normalizePath(path));
    return buildCheck({
      name: executableName,
      path,
      required: true,
      exists: Boolean(probe?.is_file),
      readyMessage: "Binary is installed.",
      missingMessage: "Binary will be installed from a release archive.",
    });
  });

  const setupUpdate: InstallCheck = {
    name: "Misty Hub",
    path: native.setup_path,
    required: false,
    exists: Boolean(setupProbe?.is_file || setupProbe?.exists),
    status: "pending",
    message: setupProbe?.exists
      ? "Hub update check is not connected yet."
      : "Hub app path could not be verified.",
  };

  return {
    os: native.os,
    arch: native.arch,
    misty_home: native.misty_home,
    install_dir: native.install_dir,
    legacy_install_dir: native.legacy_install_dir,
    db_path: native.db_path,
    current_user: native.current_user,
    current_license: native.current_license,
    ready: [...folders, ...binaries].every((check) => !check.required || check.exists),
    folders,
    binaries,
    setup_update: setupUpdate,
  };
}

function buildCheck({
  name,
  path,
  required,
  exists,
  readyMessage,
  missingMessage,
}: {
  name: string;
  path: string;
  required: boolean;
  exists: boolean;
  readyMessage: string;
  missingMessage: string;
}): InstallCheck {
  return {
    name,
    path,
    required,
    exists,
    status: exists ? "ready" : "missing",
    message: exists ? readyMessage : missingMessage,
  };
}
