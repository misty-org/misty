import {
  archiveCreate,
  archiveExtract,
  archiveList,
  fileToolsChecksum,
  fileToolsCreateSymlink,
  fileToolsReadSymlink,
  openTerminalAtPath,
} from "@/features/files/native";
import type { FileEntry } from "@/native/contracts";
import { errorText } from "@/shared/lib/format";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { selectedPathsForPane, useExplorerStore } from "../../store";
import { fileStem, parentPath } from "./selectionHelpers";

export function isArchivePath(path: string) {
  return /\.(zip|tar|tgz|tar\.gz|tar\.bz2|7z|rar)$/i.test(path);
}

// power_pack.rs's archive tools never reject a misty:// path, so a remote file
// must be gated here or it hits a raw filesystem error instead of a clear message.
export function canActOnLocalArchiveFile(
  targetEntry: FileEntry | null,
  hasRemoteSelection: boolean,
): boolean {
  return Boolean(
    targetEntry &&
    targetEntry.kind === "file" &&
    isArchivePath(targetEntry.path) &&
    !hasRemoteSelection,
  );
}

export async function previewArchive(path: string) {
  const explorer = useExplorerStore.getState();
  try {
    const result = await archiveList({ path });
    explorer.pushNotification(
      result.message || `Archive has ${result.entries.length} entries.`,
      "info",
      4500,
    );
  } catch (error) {
    explorer.pushNotification(`Archive preview failed: ${errorText(error)}`, "error", 5500);
  }
}

export async function compressSelectedItems(paneId: string) {
  const explorer = useExplorerStore.getState();
  const pane = explorer.panes[paneId];
  const paths = selectedPathsForPane(pane).filter((path) => !path.startsWith("misty://"));
  if (paths.length === 0) {
    explorer.pushNotification("Choose one or more local items to compress.", "info", 3500);
    return;
  }
  const parent = parentPath(paths[0]) || pane?.listing?.path || "";
  const baseName = paths.length === 1 ? fileStem(paths[0]) : "Archive";
  const destinationPath = `${parent}/${baseName}-${new Date().toISOString().slice(0, 10)}.zip`;
  try {
    const result = await archiveCreate({ paths, destinationPath });
    explorer.pushNotification(result.message, "success", 4500);
    void explorer.refreshPane(paneId);
  } catch (error) {
    explorer.pushNotification(`Compress failed: ${errorText(error)}`, "error", 5500);
  }
}

export async function extractArchiveHere(path: string, paneId: string) {
  const explorer = useExplorerStore.getState();
  const destinationDir = `${parentPath(path)}/${fileStem(path)}`;
  try {
    const result = await archiveExtract({ archivePath: path, destinationDir });
    explorer.pushNotification(result.message, "success", 4500);
    void explorer.refreshPane(paneId);
  } catch (error) {
    explorer.pushNotification(`Extract failed: ${errorText(error)}`, "error", 5500);
  }
}

export async function extractArchiveTo(path: string, paneId: string) {
  const explorer = useExplorerStore.getState();
  const defaultDestination = `${parentPath(path)}/${fileStem(path)}`;
  const destinationDir = window.prompt("Extract archive to folder:", defaultDestination);
  if (!destinationDir?.trim()) return;
  try {
    const result = await archiveExtract({
      archivePath: path,
      destinationDir: destinationDir.trim(),
    });
    explorer.pushNotification(result.message, "success", 4500);
    void explorer.refreshPane(paneId);
  } catch (error) {
    explorer.pushNotification(`Extract failed: ${errorText(error)}`, "error", 5500);
  }
}

export async function copySha256Checksum(path: string) {
  const explorer = useExplorerStore.getState();
  try {
    const result = await fileToolsChecksum({ path });
    await writeText(result.sha256);
    explorer.pushNotification("SHA-256 copied.", "success", 3500);
  } catch (error) {
    explorer.pushNotification(`Checksum failed: ${errorText(error)}`, "error", 5500);
  }
}

export async function createSymlinkForEntry(targetPath: string, paneId: string) {
  const defaultLink = `${targetPath}.link`;
  const linkPath = window.prompt("Create symlink at:", defaultLink);
  if (!linkPath?.trim()) return;
  const explorer = useExplorerStore.getState();
  try {
    const result = await fileToolsCreateSymlink({ targetPath, linkPath: linkPath.trim() });
    explorer.pushNotification(result.message, "success", 4500);
    void explorer.refreshPane(paneId);
  } catch (error) {
    explorer.pushNotification(`Symlink failed: ${errorText(error)}`, "error", 5500);
  }
}

export async function revealSymlinkTarget(path: string, paneId: string) {
  const explorer = useExplorerStore.getState();
  try {
    const result = await fileToolsReadSymlink({ path });
    const targetPath = result.resolvedTargetPath || result.targetPath;
    await writeText(targetPath);
    if (result.targetExists) {
      const revealPath = result.targetIsDir ? targetPath : parentPath(targetPath);
      if (revealPath) void explorer.navigatePane(paneId, revealPath);
      explorer.pushNotification("Symlink target copied and revealed.", "success", 4500);
    } else {
      explorer.pushNotification(
        "Symlink target copied, but the target does not exist.",
        "info",
        5000,
      );
    }
  } catch (error) {
    explorer.pushNotification(`Reveal symlink target failed: ${errorText(error)}`, "error", 5500);
  }
}

export async function openTerminalForEntry(path: string, isDirectory: boolean) {
  const target = isDirectory ? path : parentPath(path);
  if (!target) {
    useExplorerStore.getState().pushNotification("No containing folder was found.", "error", 3500);
    return;
  }
  try {
    await openTerminalAtPath(target);
  } catch (error) {
    useExplorerStore
      .getState()
      .pushNotification(`Terminal unavailable: ${errorText(error)}`, "error", 4500);
  }
}
