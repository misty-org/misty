import { useState, useEffect } from "react";
import { FolderOpen, Square, Undo2, X } from "lucide-react";
import { Button, IconButton } from "@/shared/ui";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  chooseOrganizationFolder,
  loadFolderHistory,
  resumeFolderOrganization,
  releaseOrganizationFolder,
  stopFolderOrganization,
  undoFolderOrganization,
  useFolderOrganization,
} from "./folderOrganization";
import "./folderWork.css";

/** Shared by the Agents workspace and floating composer; state is account-scoped. */
export function MistyFolderWork({
  accountId,
  disabled = false,
}: {
  accountId: string;
  disabled?: boolean;
}) {
  const state = useFolderOrganization();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (hasTauriInternals() && accountId) void loadFolderHistory(accountId).catch(() => {});
  }, [accountId]);
  if (!hasTauriInternals() || !accountId || /Win/.test(navigator.platform)) return null;
  const snapshot = state.accountId === accountId ? state.snapshot : undefined;
  const manifest = state.accountId === accountId ? state.manifest : undefined;
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="misty-folder-work">
      <div className="misty-folder-work__controls">
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || disabled || state.applying}
          onClick={() => void run(() => chooseOrganizationFolder(accountId))}
        >
          <FolderOpen size={14} />
          {snapshot ? snapshot.folderName : "Organize folder"}
        </Button>
        {snapshot && (
          <>
            <span>
              {snapshot.items.filter((item) => !item.directory).length} files · review before
              changes
            </span>
            <IconButton
              label="Remove folder access"
              disabled={busy || state.applying}
              onClick={() => void run(() => releaseOrganizationFolder(accountId))}
            >
              <X size={14} />
            </IconButton>
          </>
        )}
        {state.applying && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void run(() => stopFolderOrganization(accountId))}
          >
            <Square size={14} />
            Stop changes
          </Button>
        )}
      </div>
      {/* An undone run has nothing left to act on, so it stops occupying the composer. */}
      {manifest && manifest.state !== "undone" && (
        <details className="misty-folder-work__receipt" open={manifest.state === "needs_review"}>
          <summary>
            {manifest.state === "completed"
              ? "Folder organized"
              : manifest.state === "paused"
                ? "Changes paused"
                : "File operation receipt"}{" "}
            · {manifest.receipts.filter((r) => r.state === "completed").length} of{" "}
            {manifest.receipts.length} changes verified
          </summary>
          <ol>
            {manifest.receipts.map((receipt) => (
              <li key={receipt.index}>
                <span>
                  {receipt.from ?? "New folder"} → {receipt.to}
                </span>
                <span>
                  {receipt.state.replace(/_/g, " ")}
                  {receipt.error ? `: ${receipt.error}` : ""}
                </span>
              </li>
            ))}
          </ol>
          {!state.applying && ["paused", "running", "prepared"].includes(manifest.state) && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void run(() => resumeFolderOrganization(accountId))}
            >
              Resume verified plan
            </Button>
          )}
          {!state.applying && manifest.receipts.some((r) => r.state === "completed") && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void run(() => undoFolderOrganization(accountId))}
            >
              <Undo2 size={14} />
              Undo verified changes
            </Button>
          )}
        </details>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
