import { invoke } from "@tauri-apps/api/core";
import { Folder, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, IconButton } from "@/shared/ui";
import type { AgentScope } from "../model/interfaces/types";
import { agentsDeviceSnapshot, agentsRevokeFolderScope } from "../store/useAgentsStore";

/**
 * Folders on this computer that agents may list and read in desktop chats.
 * The folder is chosen in the system picker; agents never pick paths.
 */
export function SharedFolders() {
  const [folders, setFolders] = useState<AgentScope[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const snapshot = await agentsDeviceSnapshot();
    setFolders(snapshot.scopes.filter((scope) => scope.kind === "local_folder"));
  }, []);
  useEffect(() => {
    if (hasTauriInternals()) void load().catch(() => setError("Shared folders couldn’t load."));
  }, [load]);
  if (!hasTauriInternals()) return null;
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
  return (
    <section aria-label="Shared folders" className="grid gap-2">
      <h3 className="text-xs font-medium text-cream-muted">Shared folders</h3>
      <p className="text-xs text-cream-muted">
        Agents can list and read files in these folders when you chat on this computer. They can’t
        change or delete anything.
      </p>
      {folders?.map((folder) => (
        <div key={folder.id} className="flex items-center gap-3 py-1">
          <Folder className="size-4 shrink-0 text-cream-muted" />
          <span className="min-w-0 flex-1 truncate text-sm">{folder.displayName}</span>
          <IconButton
            label={`Stop sharing ${folder.displayName}`}
            disabled={busy}
            onClick={() =>
              void run(() => agentsRevokeFolderScope(folder.id), "That folder couldn’t be removed.")
            }
          >
            <X size={14} />
          </IconButton>
        </div>
      ))}
      {folders && !folders.length ? (
        <p className="text-xs text-cream-muted">No folders shared yet.</p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="justify-self-start"
        disabled={busy}
        onClick={() =>
          void run(() => invoke("agents_choose_folder_scope"), "That folder couldn’t be shared.")
        }
      >
        Share a folder
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-cream-muted">
          {error}
        </p>
      ) : null}
    </section>
  );
}
