import type {
  ContextMenuBranchItem,
  ContextMenuEntry,
} from "@/models/types/features/explorer/desktop/ExplorerContextMenu";
import { providersJobStatus, providersVerifyResult, providersVerifyStart } from "@/stores/backend";
import { useExplorerStore } from "@/stores/explorer";
import { errorText } from "@/lib/format";
import type { CompareDialogSeed } from "@/models/interfaces/features/explorer/desktop/ExplorerCompareDialog";
import { explorerCompareWithEvent } from "../ExplorerWorkspaceConstants";

export function isContextMenuBranch(item: ContextMenuEntry): item is ContextMenuBranchItem {
  return "items" in item;
}

export async function verifyExplorerRemotePath(remote: string, remotePath: string): Promise<void> {
  const explorer = useExplorerStore.getState();
  const target = window.prompt("Compare against local path or remote path in this provider:", "");
  if (!target) return;
  try {
    const local = target.startsWith("/");
    const started = await providersVerifyStart({
      source: { kind: "remote", remote, path: remotePath },
      dest: { kind: local ? "local" : "remote", remote: local ? undefined : remote, path: target },
      options: { profile: { transfers: 4, checkers: 8, retries: 3, lowLevelRetries: 10 } },
    });
    explorer.pushNotification("Verify started.", "info", 3000);
    const result = await waitForVerifyResult(started.jobId);
    const issueCount =
      result.missingOnSrc.length +
      result.missingOnDst.length +
      result.differ.length +
      result.error.length;
    explorer.pushNotification(
      result.success && issueCount === 0
        ? "Verify complete. No differences found."
        : `Verify complete. ${issueCount} ${issueCount === 1 ? "issue" : "issues"} found.`,
      result.success && issueCount === 0 ? "success" : "info",
      5500,
    );
  } catch (error) {
    explorer.pushNotification(`Verify failed: ${errorText(error)}`, "error", 5500);
  }
}

export async function waitForVerifyResult(
  jobId: string,
): Promise<Awaited<ReturnType<typeof providersVerifyResult>>> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const status = await providersJobStatus(jobId);
    if (status.resultReady) return providersVerifyResult(jobId);
    if (status.state === "failed" || status.state === "cancelled") {
      throw new Error(status.message ?? `Verify ${status.state}.`);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
  throw new Error("Verify did not finish before the local timeout.");
}

export function openCompareWith(paneId: string): void {
  window.dispatchEvent(
    new CustomEvent(explorerCompareWithEvent, { detail: compareSeedForPane(paneId) }),
  );
}

export function compareSeedForPane(paneId: string): CompareDialogSeed {
  const pane = useExplorerStore.getState().panes[paneId];
  const selectedIds = new Set(pane?.selectedIds ?? []);
  const selected = pane?.listing?.entries.find(
    (entry) => selectedIds.has(entry.id) && !entry.isDeleted,
  );
  const leftPath = selected?.path ?? pane?.listing?.path ?? "";
  return {
    paneId,
    leftPath,
    mode: selected?.kind === "folder" ? "folder" : "file",
  };
}

export function normalizedPath(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}
