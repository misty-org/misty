import { useEffect, useState } from "react";
import { confirmAction } from "@/shared/lib/confirmAction";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { OptionSelect } from "@/shared/ui";
import type { AgentScope } from "../model/types";
import { agentsDeviceSnapshot } from "../store/useAgentsStore";
import { useScheduleFolders } from "./useScheduleFolders";

const none = "none";
const writeWarning = (name: string) =>
  `This workflow runs with nobody watching. It will be able to add and edit files in “${name}”. It can't delete, rename or move anything, but an edit can overwrite a file's contents, and there's no undo.`;

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
    if (writable && !(await confirmAction(writeWarning(current.displayName), "Allow changes"))) return;
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
          <input
            type="checkbox"
            checked={chosen?.writable === true}
            onChange={(event) => void toggle(event.target.checked)}
          />{" "}
          Allow changes
        </label>
      ) : null}
    </>
  );
}
