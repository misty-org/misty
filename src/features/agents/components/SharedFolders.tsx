import { Folder, FolderPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button } from "@/shared/ui";
import type { AgentDeviceSnapshot, AgentScope } from "../model/interfaces/types";
import {
  agentsChooseFolderScope,
  agentsDeviceSnapshot,
  agentsRevokeFolderScope,
} from "../store/useAgentsStore";

const description =
  "Agents can list and read files in these folders when you chat on this computer. They can’t " +
  "change or delete anything.";

/**
 * Folders on this computer that agents may list and read in desktop chats.
 * The folder is chosen in the system picker; agents never pick paths.
 */
export function useSharedFolders() {
  const [snapshot, setSnapshot] = useState<AgentDeviceSnapshot>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => setSnapshot(await agentsDeviceSnapshot()), []);
  useEffect(() => {
    if (hasTauriInternals()) void load().catch(() => setError("Shared folders couldn’t load."));
  }, [load]);
  const run = async (action: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  const folders = snapshot?.scopes.filter((scope) => scope.kind === "local_folder");
  return {
    available: hasTauriInternals(),
    device: snapshot?.device ?? undefined,
    folders,
    busy,
    error,
    share: () =>
      void run(() => agentsChooseFolderScope(), "That folder couldn’t be shared."),
    revoke: (folder: AgentScope) =>
      void run(() => agentsRevokeFolderScope(folder.id), "That folder couldn’t be removed."),
  };
}

/** The Integrations page section: each folder gets a full row. */
export function SharedFoldersSection({ shared }: { shared: ReturnType<typeof useSharedFolders> }) {
  if (!shared.available) return null;
  return (
    <section aria-labelledby="shared-folders-heading" className="agent-integrations-section">
      <header>
        <h2 id="shared-folders-heading">Shared folders</h2>
      </header>
      <p className="agent-integrations-description">{description}</p>
      {shared.folders?.length ? (
        <div className="agent-integrations-list">
          {shared.folders.map((folder) => (
            <div key={folder.id} className="agent-integrations-row">
              <Folder size={18} aria-hidden="true" />
              <div className="agent-integrations-row-text">
                <strong>{folder.displayName}</strong>
                <span>{folder.available ? "Read only" : "Not found on this computer"}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={shared.busy}
                aria-label={`Stop sharing ${folder.displayName}`}
                onClick={() => shared.revoke(folder)}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      ) : shared.folders ? (
        <p className="agent-integrations-description">No folders shared yet.</p>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        className="agent-integrations-add"
        disabled={shared.busy}
        onClick={shared.share}
      >
        <FolderPlus size={14} />
        Share a folder
      </Button>
      {shared.error ? (
        <p role="alert" className="agent-integrations-description">
          {shared.error}
        </p>
      ) : null}
    </section>
  );
}
