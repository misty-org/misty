import { useEffect, useState } from "react";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { OptionSelect, Switch } from "@/shared/ui";
import type { AgentScope } from "../model/types";
import { agentsDeviceSnapshot, allowFolderChanges, stopFolderChanges } from "../store/useAgentsStore";
import { useScheduleFolders } from "./useScheduleFolders";

const none = "none";
/** A scheduled workflow's shared folder on this computer, and whether it may change files there. */
export function ScheduleFolderField({ workflowId }: { workflowId: string }) {
  const [folders, setFolders] = useState<AgentScope[]>([]);
  const chosen = useScheduleFolders((s) => s.byWorkflow[workflowId]);
  const setFolder = useScheduleFolders((s) => s.set);
  useEffect(() => {
    if (!hasTauriInternals()) return;
    let live = true;
    void agentsDeviceSnapshot()
      .then((snapshot) => live && setFolders(snapshot.scopes))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (!folders.length) return null;
  const options = [
    { value: none, label: "No folder" },
    ...folders.map((folder) => ({ value: folder.id, label: folder.displayName })),
  ];
  const current = folders.find((folder) => folder.id === chosen?.folderId);
  const toggle = async (writable: boolean) => {
    if (!current) return;
    const key = `workflow:${workflowId}`;
    if (writable) {
      if (!(await allowFolderChanges(key, current.id).catch(() => false))) return;
    } else {
      await stopFolderChanges(key, current.id).catch(() => undefined);
    }
    setFolder(workflowId, { folderId: current.id, writable });
  };
  return (
    <>
      <label>
        Shared folder
        <OptionSelect
          aria-label="Shared folder"
          value={current?.id ?? none}
          options={options}
          onValueChange={(value) =>
            setFolder(workflowId, value === none ? null : { folderId: value, writable: false })
          }
        />
      </label>
      {current ? (
        <label>
          Allow changes
          <Switch
            aria-label="Allow changes"
            checked={chosen?.writable === true}
            onCheckedChange={(checked) => void toggle(checked)}
          />
        </label>
      ) : null}
    </>
  );
}
