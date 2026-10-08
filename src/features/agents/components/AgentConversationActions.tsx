import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { globalMistyError } from "@/features/global-search/globalMistyActions";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Input,
} from "@/shared/ui";
import { useAgentFoldersStore } from "../folders/agentFoldersStore";
import { FolderNameDialog } from "../folders/FolderNameDialog";
import { MoveToFolderMenu } from "../folders/MoveToFolderMenu";

/** Shared by collection rows, history, recents, and the open conversation. */
export function AgentConversationActions({
  conversation,
  disabled,
  onOpen,
}: {
  /** With an agent id, the menu can file the conversation into that agent's folders. */
  conversation: { id: string; title?: string; agentId?: string; folderId?: string };
  disabled?: boolean;
  onOpen?(): void;
}) {
  const [params, setParams] = useSearchParams();
  const [action, setAction] = useState<"rename" | "delete">();
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const name = conversation.title || "Untitled conversation";
  const close = () => {
    if (!pending.current) setAction(undefined);
  };
  const submit = async () => {
    if (pending.current || disabled || !action || (action === "rename" && !title.trim())) return;
    pending.current = true;
    setBusy(true);
    setError("");
    const store = useMistyStore.getState();
    try {
      if (action === "rename") await store.renameConversation(conversation.id, title);
      else await store.deleteConversation(conversation.id);
      if (useMistyStore.getState().accountId !== store.accountId) return;
      if (action === "delete" && params.get("conversation") === conversation.id) {
        setParams(
          (current) => {
            const next = new URLSearchParams(current);
            if (next.get("conversation") === conversation.id) next.delete("conversation");
            return next;
          },
          { replace: true },
        );
      }
      setAction(undefined);
    } catch (failure) {
      if (useMistyStore.getState().accountId === store.accountId)
        setError(globalMistyError(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    trigger.current?.focus();
  };
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <IconButton ref={trigger} disabled={disabled || busy} label={`More actions for ${name}`}>
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            if (action || creatingFolder) event.preventDefault();
          }}
        >
          {onOpen && <DropdownMenuItem onSelect={onOpen}>Open</DropdownMenuItem>}
          <DropdownMenuItem
            disabled={disabled}
            onSelect={() => {
              setTitle(conversation.title || "");
              setError("");
              setAction("rename");
            }}
          >
            <Pencil /> Rename
          </DropdownMenuItem>
          {conversation.agentId && (
            <MoveToFolderMenu
              conversation={{ ...conversation, agentId: conversation.agentId }}
              disabled={disabled}
              onNewFolder={() => setCreatingFolder(true)}
            />
          )}
          <DropdownMenuItem
            disabled={disabled}
            onSelect={() => {
              setError("");
              setAction("delete");
            }}
          >
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {conversation.agentId && (
        <FolderNameDialog
          open={creatingFolder}
          title="New folder"
          description="This conversation moves into the new folder."
          submitLabel="Create"
          onOpenChange={setCreatingFolder}
          onSubmit={async (folderName) => {
            const store = useAgentFoldersStore.getState();
            const folder = await store.create(conversation.agentId!, folderName);
            await store.file(conversation.id, folder.id);
          }}
        />
      )}
      <Dialog
        open={action === "rename"}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent onCloseAutoFocus={restoreFocus}>
          <DialogTitle>Rename conversation</DialogTitle>
          <DialogDescription>Choose a name for this conversation.</DialogDescription>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Input
              aria-label="Conversation name"
              value={title}
              maxLength={64}
              disabled={busy}
              onFocus={(event) => event.target.select()}
              onChange={(event) => setTitle(event.target.value)}
            />
            {error && (
              <p role="alert" className="text-sm text-cream-muted">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={disabled || busy || !title.trim()}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={action === "delete"}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <AlertDialogContent onCloseAutoFocus={restoreFocus}>
          <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            “{name}” and its messages will be permanently deleted. Any unsent draft in this
            conversation will be discarded. This cannot be undone.
          </AlertDialogDescription>
          {error && (
            <p role="alert" className="text-sm text-cream-muted">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button disabled={disabled || busy} onClick={() => void submit()}>
              {busy ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
