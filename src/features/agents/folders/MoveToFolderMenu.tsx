import { useMemo } from "react";
import { Check, FolderInput, FolderPlus } from "lucide-react";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { globalMistyError } from "@/features/global-search/globalMistyActions";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/shared/ui";
import { useAgentFoldersStore } from "./agentFoldersStore";

/**
 * "Move to folder" inside a conversation's actions menu: its agent's folders, Recents
 * (no folder), and New folder. The current place carries a checkmark. The new-folder
 * dialog lives with the caller, outside the menu that closes when it opens.
 */
export function MoveToFolderMenu({
  conversation,
  disabled,
  onNewFolder,
}: {
  conversation: { id: string; agentId: string; folderId?: string };
  disabled?: boolean;
  onNewFolder(): void;
}) {
  const allFolders = useAgentFoldersStore((state) => state.folders);
  const folders = useMemo(
    () => allFolders.filter((folder) => folder.agentId === conversation.agentId),
    [allFolders, conversation.agentId],
  );
  const current = conversation.folderId ?? "";
  const move = (folderId: string) => {
    if (folderId === current) return;
    void useAgentFoldersStore
      .getState()
      .file(conversation.id, folderId)
      .catch((failure) => useMistyStore.setState({ error: globalMistyError(failure) }));
  };
  const place = (folderId: string, label: string) => (
    <DropdownMenuItem key={folderId || "recents"} onSelect={() => move(folderId)}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {folderId === current && <Check aria-label="Current" />}
    </DropdownMenuItem>
  );
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled}>
        <FolderInput /> Move to folder
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {folders.map((folder) => place(folder.id, folder.name))}
        {place("", "Recents")}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onNewFolder}>
          <FolderPlus /> New folder
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
