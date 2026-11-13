import { FolderPlus, PencilLine } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { confirmAction } from "@/shared/lib/confirmAction";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  DropdownMenu,
  DropdownMenuContent,
  MenuCheckItem,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  notify,
} from "@/shared/ui";
import type { AgentScope } from "../personal/agentScope";
import {
  agentsDeviceSnapshot,
  allowFolderChanges,
  shareFolder,
  stopFolderChanges,
} from "../personal/useAgentsStore";
import { useConversationFolder } from "../shared-folders/useConversationFolder";

const none = "none";

/** What sharing allows, said before the picker opens, since Auto doesn't pause for it. */
export const shareFolderWarning =
  "Agents in chats you give this folder to can read its files. " +
  "In Auto, a page could trick an agent into sending them out over the web, and Misty won't stop to ask.";

/**
 * The folder on this computer a chat on Misty's own runtime can read, or none, as a menu for the
 * context panel: pick one, share another, or let the chat change it. Only the chosen folder
 * travels with the chat. Desktop only.
 */
export function ChatFolderMenu({ conversationId }: { conversationId: string | undefined }) {
  const [folders, setFolders] = useState<AgentScope[]>([]);
  const chosen = useConversationFolder((s) =>
    conversationId ? (s.byConversation[conversationId] ?? null) : s.draft,
  );
  const chooseFolder = useConversationFolder((s) => s.chooseFolder);
  const setWritable = useConversationFolder((s) => s.setWritable);
  const canWrite = useConversationFolder((s) =>
    chosen
      ? conversationId
        ? s.writes[conversationId] === chosen
        : s.draftWrites === chosen
      : false,
  );
  const load = useCallback(
    () =>
      agentsDeviceSnapshot()
        .then((snapshot) => setFolders(snapshot.scopes))
        .catch(() => undefined),
    [],
  );
  useEffect(() => {
    if (hasTauriInternals()) void load();
  }, [load]);
  if (!hasTauriInternals()) return null;
  const current = folders.find((folder) => folder.id === chosen);
  const add = async () => {
    if (!(await confirmAction(shareFolderWarning, "Share a folder"))) return;
    try {
      const added = await shareFolder();
      await load();
      if (added) chooseFolder(conversationId, added.id);
    } catch (error) {
      const text = typeof error === "string" ? error : error instanceof Error ? error.message : "";
      notify({
        message: text && !text.includes("_") ? text : "That folder couldn’t be added.",
        tone: "error",
        id: "composer-folder",
      });
    }
  };
  const toggleWrite = async (allow: boolean) => {
    if (!current) return;
    const key = conversationId ?? "draft";
    if (allow) {
      if (await allowFolderChanges(key, current.id).catch(() => false))
        setWritable(conversationId, current.id, true);
      return;
    }
    await stopFolderChanges(key, current.id).catch(() => undefined);
    setWritable(conversationId, current.id, false);
  };
  return (
    <DropdownMenu>
      <MenuTrigger label="Chat folder" value={current?.displayName ?? "No folder"} plain />
      <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-16px)]">
        <MenuRadioGroup
          value={current?.id ?? none}
          onValueChange={(next) => chooseFolder(conversationId, next === none ? null : next)}
        >
          <MenuRadioItem value={none} label="No folder" />
          {folders.map((folder) => (
            <MenuRadioItem
              key={folder.id}
              value={folder.id}
              label={folder.displayName}
              disabled={!folder.available}
              reason={folder.available ? undefined : "This folder isn't on this computer now"}
            />
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        {current ? (
          <MenuCheckItem
            icon={PencilLine}
            label="Allow changes"
            checked={canWrite}
            onCheckedChange={(checked) => void toggleWrite(checked)}
          />
        ) : null}
        <MenuItem icon={FolderPlus} label="Share a folder" onSelect={() => void add()} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
