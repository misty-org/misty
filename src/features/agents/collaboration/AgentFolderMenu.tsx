import { FolderOpen } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { confirmAction } from "@/shared/lib/confirmAction";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  ErrorNotification,
  MenuTrigger,
} from "@/shared/ui";
import type { AgentScope } from "../model/types";
import { agentsDeviceSnapshot, shareFolder } from "../store/useAgentsStore";
import { useConversationFolder } from "../store/useConversationFolder";

const none = "none";

/** What sharing allows, said before the picker opens, since Auto doesn't pause for it. */
export const shareFolderWarning =
  "Agents in chats you give this folder to can read its files. " +
  "In Auto, a page could trick an agent into sending them out over the web, and Misty won't stop to ask.";
const writeWarning = (name: string) =>
  `Agents in this chat will be able to add and edit files in “${name}”. ` +
  "They can't delete, rename or move anything, but an edit can overwrite a file's contents, and there's no undo.";

/**
 * The composer strip's folder menu: the folder on this computer the conversation
 * can read, or none. Only the chosen folder travels with the chat. Desktop only.
 */
export function AgentFolderMenu({
  conversationId,
  disabled,
}: {
  conversationId?: string;
  disabled?: boolean;
}) {
  const [folders, setFolders] = useState<AgentScope[]>([]);
  const [failed, setFailed] = useState("");
  const chosen = useConversationFolder((s) =>
    conversationId ? (s.byConversation[conversationId] ?? null) : s.draft,
  );
  const setFolder = useConversationFolder((s) => s.setFolder);
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
    setFailed("");
    if (!(await confirmAction(shareFolderWarning, "Share a folder"))) return;
    try {
      const added = await shareFolder();
      await load();
      if (added) setFolder(conversationId, added.id);
    } catch (error) {
      const text = typeof error === "string" ? error : error instanceof Error ? error.message : "";
      setFailed(text && !text.includes("_") ? text : "That folder couldn’t be added.");
    }
  };
  const toggleWrite = async (allow: boolean) => {
    if (!current) return;
    if (allow && !(await confirmAction(writeWarning(current.displayName), "Allow changes"))) return;
    setWritable(conversationId, current.id, allow);
  };
  return (
    <>
      <DropdownMenu onOpenChange={(open) => open && void load()}>
        <MenuTrigger
          label="Folder"
          icon={<FolderOpen aria-hidden className="size-4 shrink-0" />}
          value={current?.displayName ?? "Folder"}
          title={current ? `Folder: ${current.displayName}` : "A folder this conversation can read"}
          chevron={false}
          disabled={disabled}
          className="agent-strip-chip max-w-40"
        />
        <DropdownMenuContent align="start" className="w-72" data-misty-layer-portal>
          <DropdownMenuRadioGroup
            value={current?.id ?? none}
            onValueChange={(next) => setFolder(conversationId, next === none ? null : next)}
          >
            <DropdownMenuRadioItem value={none}>No folder</DropdownMenuRadioItem>
            {folders.map((folder) => (
              <DropdownMenuRadioItem key={folder.id} value={folder.id} disabled={!folder.available}>
                <span className="min-w-0 flex-1 truncate">{folder.displayName}</span>
                {!folder.available && <span className="text-xs text-cream-muted">Not found</span>}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          {current ? (
            <DropdownMenuCheckboxItem
              checked={canWrite}
              onCheckedChange={(checked) => void toggleWrite(checked === true)}
            >
              Allow changes
            </DropdownMenuCheckboxItem>
          ) : null}
          <DropdownMenuItem onSelect={() => void add()}>
            <FolderOpen aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">Share a folder…</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ErrorNotification message={failed} onDismiss={() => setFailed("")} />
    </>
  );
}
